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

INSERT INTO symptoms (
  slug,
  description,
  category
) VALUES (
  'cranks-no-start',
  'Engine cranks normally but does not start or fire (cross-platform symptom; covers diesel HEUI no-fire conditions)',
  'no-start'
)
ON CONFLICT (slug) DO NOTHING;
