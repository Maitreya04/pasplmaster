-- Add index on updated_at to optimize delta sync polling
CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_id_updated_at ON items(id, updated_at);
