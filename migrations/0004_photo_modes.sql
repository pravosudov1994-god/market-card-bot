-- Compatibility marker. Fresh databases get photo_mode from 0001_initial.sql;
-- legacy databases are repaired safely at Worker runtime before requests are handled.
SELECT 1;
