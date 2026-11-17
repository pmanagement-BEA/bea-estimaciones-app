"""Lee las Órdenes de Trabajo (RC-OP-02) y extrae el responsable de cada área.
Uso: python leer_ot.py <carpeta_con_ot> <directorio.csv>  -> JSON {clave: {area: {nombre, email|null}}}"""
import csv, glob, json, os, re, sys, unicodedata, warnings
warnings.filterwarnings("ignore")
def norm(s): return re.sub(r"\s+", " ", unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()).strip()
ROLES = [("edificaci", "Consultoría"), ("construcci", "Consultoría (construcción)"), ("comisionamiento", "Commissioning"),
         ("commissioning", "Commissioning"), ("modelaci", "Modelación")]
def area_de(txt):
    t = norm(txt)
    if "consultor" not in t and "agente" not in t and "autoridad" not in t: return None
    for k, a in ROLES:
        if k in t: return a
    return None
def leer_xlsx(path, clave):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    hojas = [ws for ws in wb.worksheets if any(clave in str(c) for r in ws.iter_rows(max_row=6, values_only=True) for c in r if c)] or wb.worksheets[:1]
    ws = hojas[0]; filas = [list(r) for r in ws.iter_rows(max_row=80, values_only=True)]
    for i, r in enumerate(filas):
        areas = {j: area_de(str(c)) for j, c in enumerate(r) if c and area_de(str(c))}
        if len(areas) >= 2 and i + 1 < len(filas):
            nxt = filas[i + 1]
            return {a: str(nxt[j]).strip() for j, a in areas.items() if j < len(nxt) and nxt[j] not in (None, "")}
    return {}
def leer_pdf(path):
    from pypdf import PdfReader
    txt = "\n".join(p.extract_text() or "" for p in PdfReader(path).pages[:2])
    lineas = [l.strip() for l in txt.splitlines() if l.strip()]
    out = {}
    for i, l in enumerate(lineas):
        a = area_de(l)
        if a and i > 0 and a not in out:
            cand = lineas[i - 1]
            if not area_de(cand) and "RECIB" not in cand.upper(): out[a] = cand
    return out
def main(carpeta, dir_csv):
    gente = list(csv.DictReader(open(dir_csv, encoding="utf-8-sig")))
    def match(nombre):
        n = norm(nombre); toks = set(n.replace(".", " ").split())
        if not n or n in ("na", "n/a", "0", "none", "-"): return None
        best = None
        for g in gente:
            gt = norm(g["Nombre"]).split()
            if gt and gt[0] in toks and len(toks & set(gt[1:])) >= 1: return g["Correo"]
            if gt and gt[0] in toks: best = best or g["Correo"]
        return best
    res = {}
    for f in sorted(glob.glob(os.path.join(carpeta, "*"))):
        clave = os.path.basename(f)[:3]
        try:
            raw = leer_xlsx(f, clave) if f.endswith(".xlsx") else leer_pdf(f)
        except Exception as e:
            raw = {"_error": str(e)[:80]}
        res[clave] = {a: {"nombre": n, "email": match(n)} for a, n in raw.items() if not a.startswith("_")}
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)
main(*sys.argv[1:3])
