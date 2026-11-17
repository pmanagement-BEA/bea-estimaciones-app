"""
Lee un "Libro BEA" de estimación (machote RC-OP-07-11) y lo convierte al modelo de la app.

Uso:  python leer_libro.py <libro.xlsx> [<libro2.xlsx> ...] > salida.json

Estructura esperada (verificada en 543, 555, 564, 581, 583, 604, 612):
  - Hoja MONTOS: disciplina | Total | Descuento | Precio final | Estimable
  - Una hoja por mes: encabezado con IMPORTE TOTAL / ANTICIPO / FINIQUITO / ESTIMACIÓN ACTUAL,
    luego la tabla Clave | Concepto | Entregable | PRESUPUESTO (%) | MONTO | ANTERIOR (marca, $)
    | ESTIMADO ESTA ESTIMACIÓN (marca, $) | ACUMULADO | POR ESTIMAR [| Mes | Atraso | Causa]
  - Fila de disciplina: clave entera (1, 2.0, 3) con 100 %. Fila de concepto: clave 1.01, 4.18, etc.
"""
import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")

MESES = {"ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AGO": 8,
         "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12}


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


def periodo_de_hoja(nombre):
    """'OCT 2026' -> '2026-10', 'SEP-26' -> '2026-09', 'ENERO-FEBRERO 2025' -> '2025-02' (último mes)."""
    s = nombre.upper().replace("_", " ")
    anio = [x for x in re.findall(r"(?<!\d)(20\d\d|\d\d)(?!\d)", s) if 18 <= int(x[-2:]) <= 30]
    trim = re.search(r"(\d)\s*(?:ER|DO|RO|TO|O)?\s*TRIMESTRE", s)
    if trim and anio:
        a = int(anio[-1]); a = a + 2000 if a < 100 else a
        return f"{a}-{int(trim.group(1)) * 3:02d}"
    meses = [MESES[m[:3]] for m in re.findall(r"(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-Z]*", s)]
    if not meses or not anio:
        return None
    a = int(anio[-1])
    a = a + 2000 if a < 100 else a
    return f"{a}-{meses[-1]:02d}"


def encabezado(ws):
    """Busca los totales del encabezado (filas 1-15)."""
    out = {}
    etiquetas = {
        "importe_total": r"IMPORTE TOTAL",
        "anticipo": r"ANTICIPO",
        "finiquito": r"FINIQUITO",
        "estimable": r"IMPORTE ESTIMABLE(?! ADICIONAL)",
        "estimable_adicional": r"IMPORTE ESTIMABLE ADICIONAL",
        "acumulado_anterior": r"ACUMULADO ANTERIOR",
        "estimacion_actual": r"ESTIMACI[ÓO]N ACTUAL",
        "acumulado_global": r"ACUMULADO GLOBAL",
        "por_estimar": r"POR ESTIMAR",
    }
    for row in ws.iter_rows(min_row=1, max_row=15):
        cells = list(row)
        for i, c in enumerate(cells):
            t = txt(c.value).upper()
            for k, pat in etiquetas.items():
                if k not in out and re.match(pat, t):
                    for nxt in cells[i + 1:i + 5]:
                        n = num(nxt.value)
                        if n is not None:
                            out[k] = n
                            break
    return out


def columnas(ws):
    """Encuentra la fila de encabezados de la tabla y la columna de cada campo."""
    for row in ws.iter_rows(min_row=1, max_row=40):
        nombres = {}
        for c in row:  # si un encabezado se repite (p. ej. "ANTERIOR" de la estimación externa), gana el primero
            if txt(c.value) and txt(c.value).upper() not in nombres:
                nombres[txt(c.value).upper()] = c.column
        if "CLAVE" in nombres:
            col = {"fila": row[0].row, "clave": nombres["CLAVE"]}
            for k, c in nombres.items():
                if k.startswith("CONCEPTO"): col["concepto"] = c
                elif k.startswith("ENTREGABLE"): col["entregable"] = c
                elif k.startswith("PRESUPUESTO"): col["pct"] = c
                elif k == "MONTO": col["monto"] = c
                elif k.startswith("ANTERIOR"): col["anterior"] = c
                elif k.startswith("ESTIMADO"): col["esta"] = c
                elif k.startswith("ACUMULADO"): col["acumulado"] = c
                elif k.startswith("MES"): col["mes"] = c
                elif k.startswith("ATRASO"): col["atraso"] = c
                elif k.startswith("CAUSA"): col["causa"] = c
            return col
    return None


def es_disciplina(clave):
    return re.fullmatch(r"\d+(\.0)?", clave) is not None


def leer_hoja(ws):
    col = columnas(ws)
    if not col or "pct" not in col or "esta" not in col:
        return None
    disciplinas, actual, adicional = [], None, False
    claves = [txt(ws.cell(r, col["clave"]).value) for r in range(col["fila"] + 1, ws.max_row + 2)]

    def tiene_hijos(i):
        # Disciplinas con clave no entera ("2.A", "4b"): la siguiente clave con texto empieza con "<clave>."
        k = claves[i]
        for nxt in claves[i + 1:i + 4]:
            if nxt:
                if bool(k) and nxt.upper().startswith(k.upper() + "."):
                    return True
                # "60.a" con hijos "60a.01": misma clave sin el punto
                k2 = k.replace(".", "").upper()
                return (re.fullmatch(r"\d+\.?[A-Za-z]", k) is not None
                        and nxt.replace(".", "").upper().startswith(k2) and len(nxt) > len(k))
        return False

    for r in range(col["fila"] + 1, ws.max_row + 1):
        clave = txt(ws.cell(r, col["clave"]).value)
        disc_por_hijos = tiene_hijos(r - col["fila"] - 1)
        concepto = txt(ws.cell(r, col.get("concepto", col["clave"] + 1)).value)
        if not clave and not concepto:
            continue
        if clave.upper().startswith("SUMA") or concepto.upper().startswith("SUMA"):
            # Después del primer total vienen los servicios adicionales (aditivas)
            adicional, actual = True, None
            continue
        if clave.upper() in ("X.X", "X") or re.fullmatch(r"CONCEPTO \d+", concepto.upper()):
            continue  # filas vacías de la plantilla
        clave = re.sub(r"\.0$", "", clave) if es_disciplina(clave) else clave
        if clave == "0" and actual is not None:
            # "0" es disciplina solo si le siguen conceptos "0.x" (516, 523). En 470 es un concepto
            # de Commissioning con la clave mal escrita: lo siguen conceptos de la disciplina 4.
            sig = next((k for k in claves[r - col["fila"]:r - col["fila"] + 3] if k), "")
            if not sig.startswith("0."):
                clave = f"{actual['clave']}.00"
        monto_txt = txt(ws.cell(r, col["monto"]).value).upper() if "monto" in col else ""
        # Subdisciplina tipo "2.D" con 100 % cuyos conceptos se copiaron con la clave de otra ("2.C.01"…)
        pct_fila = num(ws.cell(r, col["pct"]).value)
        sub_al_100 = (re.fullmatch(r"\d+\.[A-Za-z]", clave) is not None and pct_fila is not None
                      and abs(pct_fila - 1) < 1e-6)
        # Encabezado repetido: "9B FINIQUITO (5%)" con el importe en la columna de marcas, seguido de "9B Finiquito"
        sig = next((k for k in claves[r - col["fila"]:r - col["fila"] + 3] if k), "")
        marca_fila = max(num(ws.cell(r, col["esta"]).value) or 0.0,
                         (num(ws.cell(r, col["anterior"]).value) or 0.0) if "anterior" in col else 0.0)
        encabezado_repetido = bool(clave) and sig.upper() == clave.upper() and marca_fila > 1.5
        if es_disciplina(clave) or disc_por_hijos or sub_al_100 or encabezado_repetido:
            actual = {
                "clave": clave, "nombre": concepto,
                "estimable": num(ws.cell(r, col["monto"]).value) if "monto" in col else None,
                "finiquito": "FINIQUITO" in monto_txt or "FINIQUITO" in concepto.upper(),
                "adicional": adicional,
                "conceptos": [],
            }
            disciplinas.append(actual)
            continue
        if actual is None or not re.match(r"^[\w.]+$", clave):
            continue
        pct = num(ws.cell(r, col["pct"]).value)
        marca_esta = num(ws.cell(r, col["esta"]).value) or 0.0
        marca_ant = num(ws.cell(r, col["anterior"]).value) or 0.0 if "anterior" in col else 0.0
        actual["conceptos"].append({
            "clave": clave,
            "descripcion": concepto,
            "entregable": txt(ws.cell(r, col["entregable"]).value) if "entregable" in col else "",
            "pct": (pct or 0.0) * 100 if pct is not None and pct <= 1.0001 else (pct or 0.0),
            "monto_excel": num(ws.cell(r, col["monto"]).value) if "monto" in col else None,
            "finiquito": actual["finiquito"] or "FINIQUITO" in monto_txt,
            "marca_anterior": marca_ant,
            "marca_esta": marca_esta,
            "mes": txt(ws.cell(r, col["mes"]).value) if "mes" in col else "",
            "atraso": txt(ws.cell(r, col["atraso"]).value) if "atraso" in col else "",
            "causa": txt(ws.cell(r, col["causa"]).value) if "causa" in col else "",
        })
    return disciplinas


def leer_montos(wb):
    if "MONTOS" not in wb.sheetnames:
        return []
    ws = wb["MONTOS"]
    out = []
    for row in ws.iter_rows(min_row=2, max_row=40, values_only=True):
        nombre = txt(row[1]) if len(row) > 1 else ""
        total, desc, final = (num(row[i]) if len(row) > i else None for i in (2, 3, 4))
        if nombre and total is not None and final is not None and not nombre.upper().startswith("SERVICIOS"):
            out.append({"nombre": nombre, "total": total, "descuento": desc or 0.0, "precio_final": final})
    return out


def leer_libro(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    meses = []
    for ws in wb.worksheets:
        if ws.title.strip().upper() in ("MONTOS", "MES AÑO", "MES ANO", "BASE"):
            continue
        periodo = periodo_de_hoja(ws.title)
        if not periodo:
            continue
        disciplinas = leer_hoja(ws)
        if not disciplinas:
            continue
        meses.append({"hoja": ws.title, "periodo": periodo, "encabezado": encabezado(ws), "disciplinas": disciplinas})
    # Ordenar por mes real (hay libros con hojas del más nuevo al más viejo) y quitar duplicados
    # tipo "DIC 2025 (2)": por mes se queda la hoja con mayor acumulado global.
    por_mes = {}
    for m in meses:
        prev = por_mes.get(m["periodo"])
        if prev is None or (m["encabezado"].get("acumulado_global") or 0) > (prev["encabezado"].get("acumulado_global") or 0):
            por_mes[m["periodo"]] = m
    meses = [por_mes[k] for k in sorted(por_mes)]
    return {"archivo": path, "montos": leer_montos(wb), "meses": meses}


if __name__ == "__main__":
    json.dump([leer_libro(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
