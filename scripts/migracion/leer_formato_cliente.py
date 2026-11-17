"""
Lee estimaciones en formato del cliente "CARÁTULA + SOPORTE EST." y las convierte al mismo
modelo que leer_libro.py, para conciliarlas y cargarlas con el mismo generador.

Uso:  python leer_formato_cliente.py <archivo.xlsx> [...] > lectura_cliente.json

Formato (verificado en 309, 407, 455):
  - CARÁTULA: ESTIMACION No, PERIODO DEL/HASTA, PORCENTAJE DE ANTICIPO, TOTAL ESTIMADO, MONTO TOTAL AUTORIZADO.
  - SOPORTE EST.: tabla con CLAVE | Concepto | Unidad | Cantidad | P.U. | Importe | Control de volumen (…)
    | Control de montos: Acum anterior … Esta estimación | Acum general | %.
    Las columnas se ubican a partir de la columna CLAVE (en 455 empieza en A, en 309/407 en C).
Modelo: el importe de cada concepto es bruto; el anticipo se amortiza en cada estimación. En la app
eso es: monto = importe bruto, anticipo % del proyecto, y lo estimado neto = bruto × (1 − anticipo).
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


def etiqueta(ws, patron, max_row=60, desplazamientos=(1, 2, 3)):
    """Valor numérico/fecha a la derecha de la primera celda cuyo texto coincide con patron."""
    for row in ws.iter_rows(min_row=1, max_row=max_row):
        for c in row:
            if re.match(patron, txt(c.value).upper()):
                for d in desplazamientos:
                    v = ws.cell(c.row, c.column + d).value
                    if v not in (None, ""):
                        return v
    return None


def leer(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    if "CARÁTULA" not in wb.sheetnames or "SOPORTE EST." not in wb.sheetnames:
        return {"archivo": path, "montos": [], "meses": [], "error": "No es formato CARÁTULA + SOPORTE EST."}
    car, sop = wb["CARÁTULA"], wb["SOPORTE EST."]

    numero_txt = txt(etiqueta(car, r"ESTIMACION NO"))
    numero = int(re.match(r"\d+", numero_txt).group()) if re.match(r"\d+", numero_txt) else None
    hasta = etiqueta(car, r"HASTA", desplazamientos=(1,))
    periodo = hasta.strftime("%Y-%m") if hasattr(hasta, "strftime") else None
    anticipo_pct = num(etiqueta(car, r"PORCENTAJE DE ANTICIPO")) or 0.0
    total_estimado = num(etiqueta(car, r"TOTAL ESTIMADO"))
    autorizado = num(etiqueta(car, r"MONTO TOTAL AUTORIZADO"))
    texto = " ".join(txt(c.value) for ws in (car, sop) for row in ws.iter_rows(max_row=40) for c in row)
    moneda = "USD" if re.search(r"\bUSD\b", texto) else "MXN"

    # Columnas relativas a CLAVE
    fila_h = k = None
    for row in sop.iter_rows(min_row=1, max_row=30):
        for c in row:
            if txt(c.value).upper() == "CLAVE":
                fila_h, k = c.row, c.column
                break
        if fila_h:
            break
    sub = {}
    for c in range(1, sop.max_column + 1):  # gana la primera aparición ("Importe" del contrato, no el "por ejecutar")
        sub.setdefault(txt(sop.cell(fila_h + 1, c).value).upper(), c)
    col_imp = sub.get("IMPORTE", k + 5)
    # en "Control de montos": Acum anterior … Esta estimación | Acum general
    montos = [c for c in range(1, sop.max_column + 1) if re.match(r"ACUM\s+GENERAL", txt(sop.cell(fila_h + 1, c).value).upper())]
    col_acum = montos[-1]          # el segundo "Acum general" es el de montos
    col_esta = col_acum - 1
    col_unidad = k + 2

    disciplinas, actual = [], None

    def nueva(clave, nombre):
        d = {"clave": clave, "nombre": nombre, "estimable": 0.0, "finiquito": False, "adicional": False, "conceptos": []}
        disciplinas.append(d)
        return d

    filas = []
    for r in range(fila_h + 2, sop.max_row + 1):
        clave = txt(sop.cell(r, k).value)
        concepto = txt(sop.cell(r, k + 1).value)
        if concepto.upper().startswith(("MONTO TOTAL", "TOTAL ESTIMA")):
            break
        if not clave and not concepto:
            continue
        filas.append({"clave": clave, "concepto": concepto, "imp": num(sop.cell(r, col_imp).value),
                      "acum": num(sop.cell(r, col_acum).value) or 0.0, "esta": num(sop.cell(r, col_esta).value) or 0.0,
                      "unidad": txt(sop.cell(r, col_unidad).value)})

    def es_fase(i):
        """Clave entera (1, 2.0) cuyo importe = suma de los conceptos que cuelgan de ella (1.01, 1.02…)."""
        f = filas[i]
        if not re.fullmatch(r"\d+(\.0)?", f["clave"]):
            return False
        base = re.sub(r"\.0$", "", f["clave"]) + "."
        hijos = 0.0
        for g in filas[i + 1:]:
            if not g["clave"].startswith(base):
                break
            hijos += g["imp"] or 0.0
        return hijos > 0 and abs((f["imp"] or 0.0) - hijos) <= 1

    for i, f in enumerate(filas):
        if es_fase(i) or (not f["clave"] and f["concepto"]):
            # encabezado de fase o de sección ("Certificación LEED", "Adicionales 01")
            actual = nueva(re.sub(r"\.0$", "", f["clave"]) if f["clave"] else f"S{len(disciplinas) + 1}", f["concepto"])
            continue
        if f["imp"] is None or abs(f["imp"]) < 0.005:
            continue
        if actual is None:
            actual = nueva("G", "General")
        actual["conceptos"].append({
            "clave": re.sub(r"\.0$", "", f["clave"]), "descripcion": f["concepto"], "entregable": f["unidad"],
            "importe": f["imp"], "acum": f["acum"], "esta": f["esta"],
        })

    disciplinas = [d for d in disciplinas if d["conceptos"]]
    factor = 1 - anticipo_pct
    suma_acum = 0.0
    for d in disciplinas:
        bruto = sum(c["importe"] for c in d["conceptos"])
        d["estimable"] = bruto * factor
        conceptos = []
        for c in d["conceptos"]:
            suma_acum += c["acum"]
            frac = c["acum"] / c["importe"] if c["importe"] else 0.0
            frac_esta = c["esta"] / c["importe"] if c["importe"] else 0.0
            conceptos.append({
                "clave": c["clave"], "descripcion": c["descripcion"], "entregable": c["entregable"],
                "pct": (c["importe"] / bruto) * 100 if bruto else 0.0,
                "monto_excel": c["importe"] * factor, "finiquito": False,
                "marca_anterior": frac - frac_esta, "marca_esta": frac_esta,
                "mes": "", "atraso": "", "causa": "",
            })
        d["conceptos"] = conceptos
    bruto_total = sum(d["estimable"] for d in disciplinas) / factor if factor else 0.0

    encabezado = {
        "importe_total": bruto_total,
        "anticipo": bruto_total * anticipo_pct,
        "finiquito": 0.0,
        "estimable": bruto_total * factor,
        # Neto de amortización del anticipo, igual que el "acumulado global" de la app
        "acumulado_global": total_estimado * factor if total_estimado is not None else None,
        "total_estimado_bruto": total_estimado,
        "monto_autorizado": autorizado,
        "suma_conceptos_bruto": suma_acum,
    }
    return {"archivo": path, "formato": "cliente", "moneda": moneda, "montos": [],
            "meses": [{"hoja": f"Estimación {numero} ({numero_txt})", "periodo": periodo, "numero": numero,
                       "encabezado": encabezado, "disciplinas": disciplinas}] if periodo else []}


if __name__ == "__main__":
    json.dump([leer(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
