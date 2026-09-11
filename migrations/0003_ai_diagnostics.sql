-- Compatibility marker. Fresh databases get ai_error_code from 0001_initial.sql;
-- legacy databases are repaired safely at Worker runtime before requests are handled.
SELECT 1;
