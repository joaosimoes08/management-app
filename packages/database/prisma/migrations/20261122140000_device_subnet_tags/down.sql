-- Manual reversal (Prisma does not run it). Drops the Step 36 tag tables; devices and subnets are untouched.
DROP TABLE IF EXISTS "SubnetTag";
DROP TABLE IF EXISTS "DeviceTag";
DROP TABLE IF EXISTS "Tag";
