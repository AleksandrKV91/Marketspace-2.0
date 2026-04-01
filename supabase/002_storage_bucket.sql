-- Создать bucket для временного хранения загружаемых файлов
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'uploads',
  'uploads',
  false,
  52428800,  -- 50 МБ
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
        'application/vnd.ms-excel',
        'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET file_size_limit = 52428800;

-- Политика: service_role может всё
CREATE POLICY "service_role full access"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- Политика: anon может загружать (upload от клиента)
CREATE POLICY "anon can upload"
ON storage.objects FOR INSERT
TO anon
WITH CHECK (bucket_id = 'uploads');

-- Политика: anon может читать свои файлы
CREATE POLICY "anon can read"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'uploads');

-- Политика: anon может удалять свои файлы
CREATE POLICY "anon can delete"
ON storage.objects FOR DELETE
TO anon
USING (bucket_id = 'uploads');
