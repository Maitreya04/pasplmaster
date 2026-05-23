-- Add optional GSTIN to transports for bulk import from Tally / Busy exports
ALTER TABLE transports ADD COLUMN IF NOT EXISTS gstin TEXT;

CREATE INDEX IF NOT EXISTS idx_transports_gstin ON transports(gstin) WHERE gstin IS NOT NULL;
