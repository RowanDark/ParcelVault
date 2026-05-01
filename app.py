"""
ParcelVault - Parcel Management System
Flask/SQLite web app implementing the schema and business logic from the
Access & SharePoint Implementation Guide v1.0.
"""

import base64
import csv
import getpass
import io
import os
import sqlite3
from datetime import datetime

import qrcode
from flask import (Flask, Response, flash, g, jsonify, redirect,
                   render_template, request, url_for)

app = Flask(__name__)
_secret = os.environ.get('SECRET_KEY')
if not _secret:
    import warnings
    warnings.warn(
        'SECRET_KEY environment variable not set. '
        'Using insecure fallback — set SECRET_KEY in production.',
        stacklevel=2
    )
    _secret = 'parcelvault-dev-key-change-in-prod'
app.secret_key = _secret

DATABASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'parcelvault.db')

CARRIERS = ['UPS', 'FedEx', 'USPS', 'Amazon', 'DHL', 'Other']
STATUSES = ['In Storage', 'Delivered', 'Pending', 'Damaged']
ACTIONS  = ['Received', 'Delivered', 'Batch Received', 'Batch Delivered', 'Modified']

# ── Database helpers ──────────────────────────────────────────

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    schema = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')
    with open(schema) as f:
        db.executescript(f.read())
    db.commit()
    db.close()


@app.before_request
def ensure_db():
    if not os.path.exists(DATABASE):
        init_db()
    else:
        db = get_db()
        cols = [r[1] for r in db.execute(
            "PRAGMA table_info(tbl_Parcels)"
        ).fetchall()]
        if 'DeliveryPhoto' not in cols:
            db.execute(
                "ALTER TABLE tbl_Parcels ADD COLUMN DeliveryPhoto TEXT"
            )
            db.commit()


@app.cli.command('init-db')
def init_db_command():
    """Re-create the database from schema.sql."""
    if os.path.exists(DATABASE):
        os.remove(DATABASE)
    init_db()
    print('Database initialised.')


def get_username():
    return (os.environ.get('USERNAME')
            or os.environ.get('USER')
            or getpass.getuser()
            or 'system')


def log_history(db, action, tracking_num, shipper, recipient, location_id):
    db.execute(
        """INSERT INTO tbl_History
           (ActionDate, Action, TrackingNumber, Shipper, Recipient, LocationID, PerformedBy)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
         action, tracking_num, shipper, recipient, location_id, get_username()),
    )


# ── Main navigation hub (frm_Main) ────────────────────────────

@app.route('/')
def index():
    db = get_db()
    counts = {
        row['Status']: row['n']
        for row in db.execute(
            "SELECT Status, COUNT(*) AS n FROM tbl_Parcels GROUP BY Status"
        ).fetchall()
    }
    total = sum(counts.values())
    return render_template('index.html',
                           in_storage=counts.get('In Storage', 0),
                           delivered=counts.get('Delivered', 0),
                           pending=counts.get('Pending', 0),
                           damaged=counts.get('Damaged', 0),
                           total=total)


# ── Real-time duplicate check API ─────────────────────────────

@app.route('/api/check-duplicate')
def check_duplicate():
    tn = request.args.get('tn', '').strip()
    if not tn:
        return jsonify({'duplicate': False})
    cnt = get_db().execute(
        'SELECT COUNT(*) AS n FROM tbl_Parcels WHERE TrackingNumber = ?', (tn,)
    ).fetchone()['n']
    return jsonify({'duplicate': cnt > 0, 'tracking_number': tn})


# ── Single parcel intake (frm_Intake) ─────────────────────────

@app.route('/intake', methods=['GET', 'POST'])
def intake():
    db = get_db()
    locations = db.execute(
        'SELECT * FROM tbl_Locations WHERE IsActive = 1 ORDER BY LocationName'
    ).fetchall()

    default_form = {
        'shipper': 'UPS',
        'received_date': datetime.now().strftime('%Y-%m-%dT%H:%M'),
    }

    if request.method == 'POST':
        tn          = request.form.get('tracking_number', '').strip()
        shipper     = request.form.get('shipper', 'Other')
        recipient   = request.form.get('recipient', '').strip()
        location_id = request.form.get('location_id', '').strip()
        recv_date   = request.form.get('received_date', '').strip() \
                      or datetime.now().strftime('%Y-%m-%dT%H:%M')
        notes       = request.form.get('notes', '').strip()

        errors = []
        if not tn:
            errors.append('Tracking number is required.')
        if not location_id:
            errors.append('Storage location is required.')

        # Recipient is optional — default to 'Unknown' if not provided
        if not recipient:
            recipient = 'Unknown'

        if not errors:
            dup = db.execute(
                'SELECT COUNT(*) AS n FROM tbl_Parcels WHERE TrackingNumber = ?', (tn,)
            ).fetchone()['n']
            if dup:
                errors.append(
                    f'DUPLICATE ENTRY: Tracking number {tn} already exists in the system. '
                    f'Please verify the package and tracking number.'
                )

        if errors:
            for e in errors:
                flash(e, 'error')
            return render_template('intake.html', locations=locations,
                                   carriers=CARRIERS, form=request.form)

        db.execute(
            """INSERT INTO tbl_Parcels
               (TrackingNumber, Shipper, Recipient, LocationID,
                ReceivedDate, Status, Notes, ReceivedBy)
               VALUES (?, ?, ?, ?, ?, 'In Storage', ?, ?)""",
            (tn, shipper, recipient, int(location_id),
             recv_date.replace('T', ' '), notes, get_username()),
        )
        log_history(db, 'Received', tn, shipper, recipient, int(location_id))
        db.commit()
        flash(f'Parcel {tn} successfully logged.', 'success')
        return redirect(url_for('intake'))

    return render_template('intake.html', locations=locations,
                           carriers=CARRIERS, form=default_form)


# ── Parcel list (frm_ParcelList) ──────────────────────────────

@app.route('/parcels')
def parcel_list():
    db = get_db()
    locations = db.execute(
        'SELECT * FROM tbl_Locations WHERE IsActive = 1 ORDER BY LocationName'
    ).fetchall()

    status_f   = request.args.get('status',   '')
    carrier_f  = request.args.get('carrier',  '')
    location_f = request.args.get('location', '')
    date_from  = request.args.get('date_from','')
    date_to    = request.args.get('date_to',  '')
    search     = request.args.get('search',   '').strip()

    query  = """SELECT p.ParcelID, p.TrackingNumber, p.Shipper, p.Recipient,
                       l.LocationName, p.ReceivedDate, p.Status,
                       p.DeliveredDate, p.DeliveredTo
                FROM tbl_Parcels p
                LEFT JOIN tbl_Locations l ON p.LocationID = l.LocationID
                WHERE 1=1"""
    params = []

    if status_f:
        query += ' AND p.Status = ?';          params.append(status_f)
    if carrier_f:
        query += ' AND p.Shipper = ?';         params.append(carrier_f)
    if location_f:
        query += ' AND p.LocationID = ?';      params.append(location_f)
    if date_from:
        query += ' AND date(p.ReceivedDate) >= ?'; params.append(date_from)
    if date_to:
        query += ' AND date(p.ReceivedDate) <= ?'; params.append(date_to)
    if search:
        query += ' AND (p.TrackingNumber LIKE ? OR p.Recipient LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%'])

    query += ' ORDER BY p.ReceivedDate DESC'
    parcels = db.execute(query, params).fetchall()

    return render_template('parcel_list.html',
                           parcels=parcels,
                           locations=locations,
                           carriers=CARRIERS,
                           statuses=STATUSES,
                           filters=dict(status=status_f, carrier=carrier_f,
                                        location=location_f, date_from=date_from,
                                        date_to=date_to, search=search))


# ── Parcel detail (frm_ParcelDetail) ──────────────────────────

@app.route('/parcels/<int:parcel_id>')
def parcel_detail(parcel_id):
    db = get_db()
    parcel = db.execute(
        """SELECT p.*, l.LocationName
           FROM tbl_Parcels p
           LEFT JOIN tbl_Locations l ON p.LocationID = l.LocationID
           WHERE p.ParcelID = ?""",
        (parcel_id,)
    ).fetchone()
    if not parcel:
        flash('Parcel not found.', 'error')
        return redirect(url_for('parcel_list'))
    history = db.execute(
        """SELECT h.*, l.LocationName AS LocName
           FROM tbl_History h
           LEFT JOIN tbl_Locations l ON h.LocationID = l.LocationID
           WHERE h.TrackingNumber = ?
           ORDER BY h.ActionDate DESC""",
        (parcel['TrackingNumber'],)
    ).fetchall()
    return render_template('parcel_detail.html', parcel=parcel, history=history)


# ── Delivery confirmation (frm_Deliver) ───────────────────────

@app.route('/deliver/<int:parcel_id>', methods=['GET', 'POST'])
def deliver(parcel_id):
    db = get_db()
    parcel = db.execute(
        """SELECT p.*, l.LocationName
           FROM tbl_Parcels p
           LEFT JOIN tbl_Locations l ON p.LocationID = l.LocationID
           WHERE p.ParcelID = ?""",
        (parcel_id,)
    ).fetchone()

    if not parcel:
        flash('Parcel not found.', 'error')
        return redirect(url_for('parcel_list'))
    if parcel['Status'] == 'Delivered':
        flash(f'Parcel {parcel["TrackingNumber"]} has already been delivered.', 'warning')
        return redirect(url_for('parcel_list'))

    if request.method == 'POST':
        signed_by = request.form.get('signed_by', '').strip()
        sig_data  = request.form.get('signature_data', '').strip()

        if not signed_by:
            flash('Recipient name (Signed By) is required before confirming delivery.', 'error')
            return render_template('deliver.html', parcel=parcel)

        db.execute(
            """UPDATE tbl_Parcels
               SET Status = 'Delivered', DeliveredDate = ?, DeliveredTo = ?, SignaturePath = ?
               WHERE ParcelID = ?""",
            (datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
             signed_by,
             sig_data or None,
             parcel_id),
        )
        log_history(db, 'Delivered', parcel['TrackingNumber'],
                    parcel['Shipper'], signed_by, parcel['LocationID'])
        db.commit()
        flash(f'Delivery confirmed for {parcel["TrackingNumber"]}. Signed by: {signed_by}',
              'success')
        return redirect(url_for('parcel_list'))

    return render_template('deliver.html', parcel=parcel)


# ── Storage locations (frm_Locations) ─────────────────────────

@app.route('/locations', methods=['GET', 'POST'])
def locations():
    db = get_db()

    if request.method == 'POST':
        action = request.form.get('action', '')
        if action == 'add':
            name = request.form.get('location_name', '').strip()
            desc = request.form.get('description', '').strip()
            cap  = request.form.get('capacity', '').strip() or None
            if name:
                db.execute(
                    'INSERT INTO tbl_Locations (LocationName, Description, Capacity, IsActive) VALUES (?, ?, ?, 1)',
                    (name, desc or None, cap),
                )
                db.commit()
                flash(f'Location "{name}" added successfully.', 'success')
            else:
                flash('Location name is required.', 'error')
        elif action in ('activate', 'deactivate'):
            state = 1 if action == 'activate' else 0
            db.execute('UPDATE tbl_Locations SET IsActive = ? WHERE LocationID = ?',
                       (state, request.form.get('location_id')))
            db.commit()
            flash(f'Location {"activated" if state else "deactivated"}.', 'info')
        elif action == 'edit':
            location_id  = request.form.get('location_id', '').strip()
            new_name     = request.form.get('location_name', '').strip()
            new_desc     = request.form.get('description', '').strip()
            new_capacity = request.form.get('capacity', '').strip() or None
            if not location_id:
                flash('Location ID missing.', 'error')
            elif not new_name:
                flash('Location name is required.', 'error')
            else:
                db.execute(
                    """UPDATE tbl_Locations
                       SET LocationName = ?,
                           Description  = ?,
                           Capacity     = ?
                       WHERE LocationID = ?""",
                    (new_name, new_desc or None, new_capacity, int(location_id))
                )
                db.commit()
                flash(f'Location "{new_name}" updated.', 'success')
        elif action == 'delete':
            location_id = request.form.get('location_id', '').strip()
            if not location_id:
                flash('Location ID missing.', 'error')
            else:
                in_storage = db.execute(
                    """SELECT COUNT(*) AS n FROM tbl_Parcels
                       WHERE LocationID = ? AND Status = 'In Storage'""",
                    (int(location_id),)
                ).fetchone()['n']
                if in_storage > 0:
                    flash(
                        f'Cannot delete — {in_storage} parcel(s) currently '
                        f'In Storage at this location. '
                        f'Deliver or reassign them first.',
                        'error'
                    )
                else:
                    loc = db.execute(
                        'SELECT LocationName FROM tbl_Locations WHERE LocationID = ?',
                        (int(location_id),)
                    ).fetchone()
                    db.execute(
                        'DELETE FROM tbl_Locations WHERE LocationID = ?',
                        (int(location_id),)
                    )
                    db.commit()
                    flash(
                        f'Location "{loc["LocationName"] if loc else location_id}" deleted.',
                        'success'
                    )
        return redirect(url_for('locations'))

    locs = db.execute(
        """SELECT l.*,
                  COUNT(CASE WHEN p.Status = 'In Storage' THEN p.ParcelID END) AS ParcelsInStorage
           FROM tbl_Locations l
           LEFT JOIN tbl_Parcels p ON l.LocationID = p.LocationID
           GROUP BY l.LocationID
           ORDER BY l.IsActive DESC, l.LocationName"""
    ).fetchall()
    return render_template('locations.html', locations=locs)


# ── History date-grouping helper ─────────────────────────────

def _group_records_by_date(records, today):
    """Return records bucketed by calendar day, newest first.

    Each bucket: {'date_key': 'YYYY-MM-DD', 'label': 'Month D, YYYY',
                  'is_today': bool, 'records': [...]}
    """
    from itertools import groupby as _groupby

    def _date_key(r):
        return (r['ActionDate'] or '')[:10] or 'unknown'

    def _label(key):
        if not key or key == 'unknown':
            return 'Unknown'
        try:
            return datetime.strptime(key, '%Y-%m-%d').strftime('%-d %B %Y').lstrip('0') \
                   or datetime.strptime(key, '%Y-%m-%d').strftime('%B %-d, %Y')
        except ValueError:
            return key

    def _friendly(key):
        if not key or key == 'unknown':
            return 'Unknown'
        try:
            return datetime.strptime(key, '%Y-%m-%d').strftime('%B %-d, %Y')
        except ValueError:
            return key

    grouped = []
    for key, group_iter in _groupby(records, key=_date_key):
        grouped.append({
            'date_key': key,
            'label':    _friendly(key),
            'is_today': key == today,
            'records':  list(group_iter),
        })
    return grouped


# ── QR code generation ────────────────────────────────────────

@app.route('/locations/<int:location_id>/qr')
def location_qr(location_id):
    db = get_db()
    location = db.execute(
        'SELECT * FROM tbl_Locations WHERE LocationID = ?',
        (location_id,)
    ).fetchone()
    if not location:
        flash('Location not found.', 'error')
        return redirect(url_for('locations'))

    payload = f'PVLOC:{location_id}'

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color='black', back_color='white')

    buf = io.BytesIO()
    img.save(buf, format='PNG')
    img_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    return render_template('location_qr.html',
                           location=location,
                           img_b64=img_b64,
                           payload=payload)


# ── Audit history ─────────────────────────────────────────────

@app.route('/history')
def history():
    db      = get_db()
    search   = request.args.get('search',   '').strip()
    action_f = request.args.get('action',   '')
    date_from= request.args.get('date_from','')
    date_to  = request.args.get('date_to',  '')

    query  = """SELECT h.*, l.LocationName
                FROM tbl_History h
                LEFT JOIN tbl_Locations l ON h.LocationID = l.LocationID
                WHERE 1=1"""
    params = []

    if search:
        query += ' AND (h.TrackingNumber LIKE ? OR h.Recipient LIKE ? OR h.PerformedBy LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%', f'%{search}%'])
    if action_f:
        query += ' AND h.Action = ?'; params.append(action_f)
    if date_from:
        query += ' AND date(h.ActionDate) >= ?'; params.append(date_from)
    if date_to:
        query += ' AND date(h.ActionDate) <= ?'; params.append(date_to)

    query += ' ORDER BY h.ActionDate DESC LIMIT 500'
    records = db.execute(query, params).fetchall()

    today = datetime.now().strftime('%Y-%m-%d')
    grouped = _group_records_by_date(records, today)

    return render_template('history.html', grouped=grouped, total=len(records),
                           actions=ACTIONS, today=today,
                           filters=dict(search=search, action=action_f,
                                        date_from=date_from, date_to=date_to))


# ── CSV export (qry_HistoricalReport) ─────────────────────────

@app.route('/export')
def export_csv():
    db = get_db()
    rows = db.execute(
        """SELECT h.ActionDate, h.Action, h.TrackingNumber, h.Shipper,
                  h.Recipient, l.LocationName, h.PerformedBy,
                  p.DeliveredDate, p.DeliveredTo
           FROM tbl_History h
           LEFT JOIN tbl_Locations l ON h.LocationID = l.LocationID
           LEFT JOIN tbl_Parcels   p ON h.TrackingNumber = p.TrackingNumber
           ORDER BY h.ActionDate DESC"""
    ).fetchall()

    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(['ActionDate','Action','TrackingNumber','Shipper','Recipient',
                'LocationName','PerformedBy','DeliveredDate','DeliveredTo'])
    for row in rows:
        w.writerow(list(row))

    filename = f'ParcelVault_Export_{datetime.now().strftime("%Y%m%d_%H%M")}.csv'
    return Response(buf.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename={filename}'})


# ── Scan-to-deliver (QR location scan) ───────────────────────

@app.route('/deliver/scan', methods=['GET', 'POST'])
def deliver_scan():
    db = get_db()

    if request.method == 'POST':
        action      = request.form.get('action', '')
        location_id = request.form.get('location_id', '')
        signed_by   = request.form.get('signed_by', '').strip()
        sig_data    = request.form.get('signature_data', '').strip()
        photo_data  = request.form.get('photo_data', '').strip()
        parcel_ids  = request.form.getlist('parcel_ids')

        if action == 'confirm' and parcel_ids and signed_by:
            now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            delivered = 0
            for pid in parcel_ids:
                try:
                    pid_int = int(pid)
                except (ValueError, TypeError):
                    continue
                parcel = db.execute(
                    'SELECT * FROM tbl_Parcels WHERE ParcelID = ?',
                    (pid_int,)
                ).fetchone()
                if not parcel or parcel['Status'] == 'Delivered':
                    continue
                db.execute(
                    """UPDATE tbl_Parcels
                       SET Status = 'Delivered',
                           DeliveredDate = ?,
                           DeliveredTo = ?,
                           SignaturePath = ?,
                           DeliveryPhoto = ?
                       WHERE ParcelID = ?""",
                    (now,
                     signed_by,
                     sig_data or None,
                     photo_data or None,
                     pid_int),
                )
                log_history(db, 'Delivered',
                            parcel['TrackingNumber'],
                            parcel['Shipper'],
                            signed_by,
                            parcel['LocationID'])
                delivered += 1
            db.commit()
            flash(f'{delivered} parcel(s) delivered to '
                  f'{request.form.get("location_name", "location")}.',
                  'success')
            return redirect(url_for('deliver_scan'))

        if action == 'location_scanned' and location_id:
            parcels = db.execute(
                """SELECT p.*, l.LocationName
                   FROM tbl_Parcels p
                   LEFT JOIN tbl_Locations l
                          ON p.LocationID = l.LocationID
                   WHERE p.LocationID = ?
                     AND p.Status = 'In Storage'
                   ORDER BY p.ReceivedDate""",
                (location_id,)
            ).fetchall()
            location = db.execute(
                'SELECT * FROM tbl_Locations WHERE LocationID = ?',
                (location_id,)
            ).fetchone()
            if not location:
                flash('Location not found.', 'error')
                return redirect(url_for('deliver_scan'))
            if not parcels:
                return render_template('deliver_scan.html',
                                       state='empty',
                                       parcels=[],
                                       location=location)
            return render_template('deliver_scan.html',
                                   state='confirm',
                                   parcels=parcels,
                                   location=location)

    return render_template('deliver_scan.html',
                           state='scan',
                           parcels=[],
                           location=None)


if __name__ == '__main__':
    if not os.path.exists(DATABASE):
        init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
