-- Logo del cliente para el reporte mensual RC-OP-01 (el archivo vive en el bucket privado formatos-cliente/<project_id>/)
alter table projects add column if not exists logo_cliente text;
