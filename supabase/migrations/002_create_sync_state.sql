-- Shadow MLS - Sync State Table Migration
-- 
-- This migration creates the sync state table for tracking delta sync progress.
-- The ETL worker reads last_sync_timestamp to fetch only modified records,
-- and updates it ONLY after all pages are successfully processed.
--
-- Run: supabase db push (or apply via Supabase dashboard)
--

-- ============================================================================
-- Create sync_state table
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_state (
  -- Primary key (fixed to 'master' for single-row state tracking)
  id TEXT PRIMARY KEY DEFAULT 'master',
  
  -- Last successful sync timestamp (ISO 8601)
  -- Used as ModificationTimestamp filter for delta syncs
  last_sync_timestamp TIMESTAMPTZ NOT NULL,
  
  -- Human-readable sync metadata
  sync_type VARCHAR(20) DEFAULT 'delta',  -- 'delta' or 'full'
  records_synced INTEGER DEFAULT 0,       -- Count of records in last run
  status VARCHAR(20) DEFAULT 'idle',     -- 'idle', 'running', 'completed', 'failed'
  
  -- Timestamps for audit trail
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Triggers for updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_sync_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_sync_state_updated_at
  BEFORE UPDATE ON sync_state
  FOR EACH ROW
  EXECUTE FUNCTION update_sync_state_updated_at();

-- ============================================================================
-- Insert default row (24 hours ago for initial delta sync)
-- ============================================================================

INSERT INTO sync_state (id, last_sync_timestamp, status)
VALUES ('master', NOW() - INTERVAL '24 hours', 'idle')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE sync_state IS 'Shadow MLS - Delta sync state tracker. Single-row table for tracking last successful sync timestamp.';
COMMENT ON COLUMN sync_state.id IS 'Fixed to ''master''. Only one row exists for simple state tracking.';
COMMENT ON COLUMN sync_state.last_sync_timestamp IS 'ISO 8601 timestamp. ETL uses ModificationTimestamp gt this value for delta syncs.';
COMMENT ON COLUMN sync_state.status IS 'Sync lifecycle: idle -> running -> completed/failed';