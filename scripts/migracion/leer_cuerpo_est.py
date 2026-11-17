"""
Lee estimaciones en formato del cliente "CUERPO EST" (estimación de subcontrato con contrato
original + convenios modificatorios + órdenes de cambio) y las convierte al mismo modelo que
leer_formato_cliente.py, para conciliarlas y cargarlas con el mismo generador.

Uso:  python leer_cuerpo_est.py <archivo.xlsx> [...] > lectura_cuerpo.json

Formato (verificado en 253):
  - Encabezado: TOTAL CONTRATADO, NO. ESTIMACIÓN, PERIODO (fecha inicial).
  - Tabla: No. | Concepto | Contrato (Unidad, Cantidad, P.U., Importe) | OC… | Contrato Actualizado
    | Acumulado estimado anterior | Esta estimación | Acumulado estimado | Por estimar
    (cada grupo con Cantidad | Importe).
  - Bloques en mayúsculas ("CONTRATO ORIGINAL", "CONVENIO MODIFICATORIO 1") y disciplinas con
    número en la columna No.; los conceptos son los renglones con importe actualizado.
Se usa el importe de "Contrato Actualizado" (ya con OCs). El renglón SUMAS del cliente no se usa
porque sus fórmulas pueden omitir bloques; en su lugar se valida que:
  suma de conceptos = TOTAL CONTRATADO  y  TOTAL CONTRATADO − Por estimar (SUMAS) = acumulado.
"""
import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def txt(v):
    return "" if v is None else str(v).strip()


def norm(s):
    return re.sub(r"\s+", " ", txt(s).upper())


def hoja_cuerpo(wb):
    for n in wb.sheetnames:
        if "CUERPO EST" in n.upper() and "ACTUAL" in n.upper():
            return wb[n]
    for n in wb.sheetnames:
        if "CUERPO EST" in n.upper():
            return wb[n]
    return None


def etiqueta(ws, patron, max_row=30):
    """Primer valor no vacío a la derecha de la celda cuyo texto coincide con patron."""
    for row in ws.iter_rows(min_row=1, max_row=max_row):
        for c in row:
            if re.match(patron, norm(c.value)):
                for d in range(1, 12):
                    v = ws.cell(c.row, c.column + d).value
                    if v not in (None, ""):
                        return v
    return None


def leer(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = hoja_cuerpo(wb)
    if ws is None:
        return {"archivo": path, "montos": [], "meses": [], "error": "No es formato CUERPO EST"}

    total_contratado = num(etiqueta(ws, r"TOTAL CONTRATADO"))
    numero = etiqueta(ws, r"NO\. ESTIMACI")
    numero = int(num(numero)) if num(numero) is not None else None
    inicio = etiqueta(ws, r"PERIODO")
    periodo = inicio.strftime("%Y-%m") if hasattr(inicio, "strftime") else None

    # Fila de encabezados de grupo y sus columnas de Importe (la segunda columna de cada grupo)
    fila_h = None
    for row in ws.iter_rows(min_row=1, max_row=40):
        for c in row:
            if norm(c.value) == "CONTRATO ACTUALIZADO":
                fila_h = c.row
        if fila_h:
            break
    grupos = {}
    for c in range(1, ws.max_column + 1):
        t = norm(ws.cell(fila_h, c).value)
        if t:
            grupos[t] = c
    col_no = grupos.get("NO.", 2)
    col_concepto = grupos.get("CONCEPTO", col_no + 1)

    def importe_de(nombre):
        c = grupos[nombre]
        # la columna "Importe" del grupo está en la fila de subencabezados
        for d in range(0, 3):
            if norm(ws.cell(fila_h + 1, c + d).value) == "IMPORTE":
                return c + d
        raise ValueError(f"Sin columna Importe para {nombre}")

    col_act = importe_de("CONTRATO ACTUALIZADO")
    col_ant = importe_de("ACUMULADO ESTIMADO ANTERIOR")
    col_esta = importe_de("ESTA ESTIMACIÓN")
    col_acum = importe_de("ACUMULADO ESTIMADO")
    col_por = importe_de("POR ESTIMAR")
    col_pu = col_concepto + 3  # Contrato: Unidad, Cantidad, P.U., Importe
    col_unidad = col_concepto + 1

    disciplinas, actual, bloque = [], None, None
    por_estimar_sumas = None

    def nueva(clave, nombre):
        d = {"clave": clave, "nombre": nombre, "conceptos": []}
        disciplinas.append(d)
        return d

    for r in range(fila_h + 2, ws.max_row + 1):
        concepto = txt(ws.cell(r, col_concepto).value)
        etiqueta_suma = " ".join(norm(ws.cell(r, c).value) for c in range(1, col_concepto + 5))
        if "SUMAS" in etiqueta_suma:
            por_estimar_sumas = num(ws.cell(r, col_por).value)
            break
        no = num(ws.cell(r, col_no).value)
        act = num(ws.cell(r, col_act).value)
        pu = num(ws.cell(r, col_pu).value)
        if no is not None and concepto:
            actual = nueva(str(int(no)) if no == int(no) else str(no), concepto)
            continue
        if concepto and concepto == concepto.upper() and pu is None and re.search(r"[A-Z]", concepto):
            # bloque: "CONTRATO ORIGINAL", "CONVENIO MODIFICATORIO 1"
            bloque, actual = concepto, None
            continue
        if not concepto or act is None or abs(act) < 0.005:
            continue
        if pu is None:  # renglón descriptivo sin precio
            continue
        if actual is None:
            actual = nueva(f"B{len(disciplinas) + 1}", (bloque or "General").capitalize())
        actual["conceptos"].append({
            "descripcion": concepto, "entregable": txt(ws.cell(r, col_unidad).value),
            "importe": act, "anterior": num(ws.cell(r, col_ant).value) or 0.0,
            "esta": num(ws.cell(r, col_esta).value) or 0.0, "acum": num(ws.cell(r, col_acum).value) or 0.0,
            "por": num(ws.cell(r, col_por).value) or 0.0,
        })

    disciplinas = [d for d in disciplinas if d["conceptos"]]
    suma_importe = sum(c["importe"] for d in disciplinas for c in d["conceptos"])
    suma_acum = sum(c["acum"] for d in disciplinas for c in d["conceptos"])
    avisos = []
    for d in disciplinas:
        for c in d["conceptos"]:
            if abs(c["anterior"] + c["esta"] - c["acum"]) > 1:
                avisos.append(f"{c['descripcion']}: anterior + esta ≠ acumulado")
            if abs(c["importe"] - c["acum"] - c["por"]) > 1:
                avisos.append(f"{c['descripcion']}: importe − acumulado ≠ por estimar")

    for i, d in enumerate(disciplinas, 1):
        bruto = sum(c["importe"] for c in d["conceptos"])
        d["clave"] = str(i)
        d.update({"estimable": bruto, "finiquito": False, "adicional": False})
        d["conceptos"] = [{
            "clave": f"{i}.{j}", "descripcion": c["descripcion"], "entregable": c["entregable"],
            "pct": c["importe"] / bruto * 100 if bruto else 0.0, "monto_excel": c["importe"], "finiquito": False,
            "marca_anterior": c["anterior"] / c["importe"], "marca_esta": c["esta"] / c["importe"],
            "mes": "", "atraso": "", "causa": "",
        } for j, c in enumerate(d["conceptos"], 1)]

    # Acumulado según el propio cliente, sin depender del renglón SUMAS de "Acumulado estimado"
    acum_excel = (total_contratado - por_estimar_sumas) if None not in (total_contratado, por_estimar_sumas) else None
    encabezado = {
        "importe_total": suma_importe, "anticipo": 0.0, "finiquito": 0.0, "estimable": suma_importe,
        "acumulado_global": acum_excel,
        "total_contratado": total_contratado, "por_estimar": por_estimar_sumas,
        "suma_conceptos_acumulado": suma_acum,
        "contrato_cuadra": total_contratado is not None and abs(suma_importe - total_contratado) <= 1,
        "avisos": avisos,
    }
    return {"archivo": path, "formato": "cliente", "moneda": "MXN", "montos": [],
            "meses": [{"hoja": f"Estimación {numero} ({ws.title})", "periodo": periodo, "numero": numero,
                       "encabezado": encabezado, "disciplinas": disciplinas}] if periodo else []}


if __name__ == "__main__":
    json.dump([leer(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
