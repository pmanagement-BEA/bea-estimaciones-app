// Verifica las reglas de cálculo contra el Excel real 000000-612-Estimación.xlsx (Trebotti Santa Fe 2).
// Correr: node tests/calculos-612.mjs
import { estimationSummary } from '../src/utils/calculations.js'
const D = (id,name,monto,concepts)=>({id,name,monto_total:monto,descuento:5,concepts:concepts.map(([cid,pct,type='Normal'])=>({id:cid,pct,type}))})
const discs=[
 D('f1','Fase Uno: Diagnóstico',45400,[['1.01',25.5],['1.02',25.5],['1.03',49]]),
 D('f2','Fase Dos: Asesoría y Gestión LEED Diseño',204800,[['2.01',12.37],['2.02',10.96]]),
 D('f3','Fase Tres: Asesoría y Gestión LEED Construcción',186200,[['3.01',9.76],['3.24',1.31],['3.25',1.31],['3.26',1.31],['3.27',0.92]]),
 D('cx','Fundamental Commissioning',158000,[['4.01',1.77],['4.02',2.42],['4.03',2.42],['4.06',4.39]]),
 D('me','Eficiencia Energética & Modelación Energética',135400,[['6.01',56]]),
 D('fin','Certificación (FINIQUITO)',0,[['7.01',45,'Finiquito'],['7.02',30,'Finiquito'],['7.03',25,'Finiquito']]),
]
const rates={anticipoPct:10,finiquitoPct:5}
const inc=ids=>Object.fromEntries(ids.map(i=>[i,{concept_id:i,included:true}]))
const sepIds=['1.01','2.01','4.01','4.02'], octIds=['1.03','3.01','3.24','3.25','3.26','3.27','4.03','4.06']
const sep={id:'sep',status:'Enviada',created_at:'2026-10-01',estimation_items:sepIds.map(i=>({concept_id:i,included:true}))}
const r1=estimationSummary(discs,[],'x',inc(sepIds),rates)
const r2=estimationSummary(discs,[sep],'oct',inc(octIds),rates)
const f=n=>n.toFixed(2)
console.log('totales',f(r1.totals.conDescuento),f(r1.totals.anticipo),f(r1.totals.finiquito),f(r1.totals.estimable),' esperado 693310 69331 34665.50 589313.50')
console.log('SEP actual',f(r1.actual),'avance',f(r1.advanceThis),f(r1.advanceGlobal),'LEED',f(r1.areaAvance['Consultoría'].pct),'Cx',f(r1.areaAvance.Commissioning.pct),' esperado 35151.25 5.96 5.07 7.19 3.56')
console.log('OCT anterior',f(r2.acumAnterior),'actual',f(r2.actual),'global',f(r2.acumGlobal),'porEstimar',f(r2.porEstimar),' esperado 35151.25 48619.27 83770.52 505542.98')
console.log('OCT avance',f(r2.advanceThis),f(r2.advanceGlobal),'LEED',f(r2.areaAvance['Consultoría'].pct),'Cx',f(r2.areaAvance.Commissioning.pct),'Mod',f(r2.areaAvance['Modelación'].pct),' esperado 8.25 12.08 16.82 9.35 0.00')
const r3=estimationSummary(discs,[sep],'z',inc(['7.01']),rates); console.log('finiquito 7.01',f(r3.actualFin),' esperado',f(.45*34665.5))
