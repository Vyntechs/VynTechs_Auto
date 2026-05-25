-- ===========================================================================
-- Batch 1: platform + symptom (foundation for all downstream FKs)
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: 2003-2007 Ford F-250 6.0L Power Stroke Diesel (HEUI)
-- Symptom:  cranks-no-start (cross-platform, covers HEUI no-fire conditions)
-- ===========================================================================
-- Convention: platform slug follows existing precedent (no year range in slug;
-- year range lives in year_range column). Slug parallels ford-super-duty-4th-gen-67-psd.
-- symptoms.ON CONFLICT (slug) DO NOTHING — idempotent re-apply is safe.
-- ===========================================================================

INSERT INTO platforms (
  slug,
  year_range,
  parent_make,
  parent_model_family,
  generation
) VALUES (
  'ford-super-duty-3rd-gen-60-psd',
  '2003-2007',
  'Ford',
  'F-250',
  '3rd gen'
);

-- system='high-pressure-oil-injection' so loadSystemTopology can match this
-- symptom to the 6.0 PSD HPOP/HEUI components (the diagnosis-defining system
-- for this case). Matches the existing 6.7L precedent which uses 'fuel'.
-- KNOWN LIMITATION: this assumes the only platform with cranks-no-start is
-- the 6.0 PSD case. If another platform's cranks-no-start arrives (e.g., a
-- 6.7L electrical no-start), the symptom→system mapping will need to become
-- per-platform (likely via a join table). Acceptable for now since this is
-- the only seeded use.
INSERT INTO symptoms (
  slug,
  description,
  category,
  system
) VALUES (
  'cranks-no-start',
  'Engine cranks normally but does not start or fire (cross-platform symptom; covers diesel HEUI no-fire conditions)',
  'no-start',
  'high-pressure-oil-injection'
)
ON CONFLICT (slug) DO NOTHING;
