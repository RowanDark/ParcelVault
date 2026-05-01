-- ParcelVault Database Schema
-- SQLite equivalent of the Access/SharePoint schema defined in the implementation guide

CREATE TABLE IF NOT EXISTS tbl_Locations (
    LocationID   INTEGER PRIMARY KEY AUTOINCREMENT,
    LocationName TEXT    NOT NULL,
    Description  TEXT,
    Capacity     INTEGER,
    LocationPhoto TEXT,
    IsActive     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_Parcels (
    ParcelID       INTEGER PRIMARY KEY AUTOINCREMENT,
    TrackingNumber TEXT    NOT NULL,
    Shipper        TEXT    NOT NULL DEFAULT 'Other',
    Recipient      TEXT    NOT NULL,
    LocationID     INTEGER,
    ReceivedDate   TEXT    NOT NULL,
    Status         TEXT    NOT NULL DEFAULT 'In Storage',
    Notes          TEXT,
    ReceivedBy     TEXT,
    PackagePhoto   TEXT,
    DeliveredDate  TEXT,
    DeliveredTo    TEXT,
    SignaturePath  TEXT,
    DeliveryPhoto  TEXT,
    FOREIGN KEY (LocationID) REFERENCES tbl_Locations(LocationID)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_tracking ON tbl_Parcels(TrackingNumber);

CREATE TABLE IF NOT EXISTS tbl_History (
    HistoryID      INTEGER PRIMARY KEY AUTOINCREMENT,
    ActionDate     TEXT    NOT NULL,
    Action         TEXT    NOT NULL,
    TrackingNumber TEXT    NOT NULL,
    Shipper        TEXT,
    Recipient      TEXT,
    LocationID     INTEGER,
    PerformedBy    TEXT
);

-- Seed default storage locations (Appendix B)
INSERT OR IGNORE INTO tbl_Locations (LocationID, LocationName, Description, IsActive) VALUES
    (1, 'HR',              1),
    (2, 'Accounting',      1),
    (3, 'Tech Support',    1),
    (4, 'Reception Desk',  1),
    (5, 'Purchasing',      1),
    (6, 'IT',              1),
    (7, 'Maintenance',     1),
    (8, 'Warehouse',       1),
    (9, 'QC',              1);
    (6, 'IT Department Hold',      'Hold area for IT department packages',       1),
    (7, 'Oversized / Freight Area','Area for oversized packages and freight',    1);
