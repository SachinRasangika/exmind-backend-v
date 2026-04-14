-- AlterTable
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "location_latitude" DECIMAL(10,7);
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "location_longitude" DECIMAL(10,7);
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "location_place_name" VARCHAR(512);
