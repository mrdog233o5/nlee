import { useMemo } from 'react';
import ExcelJS from 'exceljs';
import { simulateJavaCode } from '../utils/traceTableSimulator';

export default function TraceTable({ code }) {

  const result = useMemo(() => simulateJavaCode(code), [code]);

  const { columns, steps, output, error } = result;

  // Build merged rows: variable state + condition evaluations per step
  // Variable columns use carry-over (inherit unchanged from previous row)
  // Condition columns show value only when evaluated in that step
  const fullSteps = useMemo(() => {
    const rows = [];
    let prevVars = {};
    for (const step of steps) {
      const varRow = { ...prevVars, ...step.vars };
      rows.push({ vars: varRow, conditions: step.conditions || {} });
      prevVars = varRow;
    }
    return rows;
  }, [steps]);

  // Ordered column names
  const colNames = columns.map((c) => c.name);
  const isConditionCol = (name) => columns.some((c) => c.name === name && c.isCondition);

  // Compute column groups (shared between table header and export)
  const groups = useMemo(() => {
    if (!columns.length) return [];
    const result = [];
    let cg = columns[0].group;
    let start = 0;
    for (let i = 0; i <= columns.length; i++) {
      const g = i < columns.length ? columns[i].group : null;
      if (g !== cg || i === columns.length) {
        result.push({ label: cg, count: i - start, startCol: start });
        cg = g;
        start = i;
      }
    }
    return result;
  }, [columns]);

  const colGroupCounts = useMemo(() => {
    const counts = [];
    let cg = columns[0]?.group;
    let buf = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].group !== cg) {
        for (const ci of buf) counts[ci] = buf.length;
        cg = columns[i].group;
        buf = [];
      }
      buf.push(i);
    }
    for (const ci of buf) counts[ci] = buf.length;
    return counts;
  }, [columns]);

  const hasOutput = useMemo(
    () => columns.some((c) => c.group === 'output'),
    [columns]
  );

  const exportXLSX = async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Trace Table');
    const nCols = columns.length;

    // Row 1: Group headers
    const groupRow = columns.map((_, i) => {
      const g = groups.find(g => g.startCol <= i && i < g.startCol + g.count);
      return i === (g ? g.startCol : 0) ? (g ? g.label : '') : '';
    });

    // Row 2: Column headers (skip count=1 groups — merged with row 1)
    const colHeaderRow = columns.map((col, i) =>
      colGroupCounts[i] === 1 ? '' : col.name
    );

    // Row 3+: Data rows (web display logic)
    const dataRows = fullSteps.map((row, ri) => {
      const isLastRow = ri === fullSteps.length - 1;
      return colNames.map((name) => {
        if (name === 'Output') return isLastRow && output ? output : '';
        if (isConditionCol(name)) {
          const cv = row.conditions[name];
          return cv !== undefined ? cv : '';
        }
        const val = row.vars[name];
        if (ri === 0) return val ?? '';
        const pv = fullSteps[ri - 1].vars[name];
        return val !== pv ? (val ?? '') : '';
      });
    });

    // Add all rows
    ws.addRows([groupRow, colHeaderRow, ...dataRows]);

    // Merge cells for group headers
    for (const g of groups) {
      if (g.count === 1) {
        // Single-column group: vertical merge (row 1-2)
        ws.mergeCells(1, g.startCol + 1, 2, g.startCol + 1);
      } else {
        // Multi-column group: horizontal merge (row 1 only)
        ws.mergeCells(1, g.startCol + 1, 1, g.startCol + g.count);
      }
    }

    // Styles: header rows (1-2) — bold + center
    for (let c = 1; c <= nCols; c++) {
      ws.getCell(1, c).font = { bold: true };
      ws.getCell(1, c).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(2, c).font = { bold: true };
      ws.getCell(2, c).alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // Styles: data rows (3+) — center
    const lastDataRow = 2 + dataRows.length;
    for (let r = 3; r <= lastDataRow; r++) {
      for (let c = 1; c <= nCols; c++) {
        ws.getCell(r, c).alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }

    // Download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trace-table.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Get the previous row's effective value for a column */
  const prevValue = (rowIdx, colIdx) => {
    if (rowIdx === 0) return undefined;
    const name = colNames[colIdx];
    const prev = fullSteps[rowIdx - 1];
    if (name === 'Output') return output;
    const condV = prev.conditions[name];
    if (condV !== undefined) return condV;
    return prev.vars[name];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <h2 style={{ display: 'none' }}>Trace Table</h2>

      {error && <div className="fc-error">Error: {error}</div>}

      {columns.length > 0 && (
        <div className="fc-toolbar">
          <button className="fc-export-btn" onClick={exportXLSX}>
            Export XLSX
          </button>
        </div>
      )}

      <div className="tt-wrapper">
        {columns.length > 0 ? (
          <table className="tt-table">
            <thead>
              {(() => {
                if (!hasOutput) return null;
                return (
                  <>
                    <tr className="tt-group-row">
                      {groups.map((g, gi) => (
                        <th
                          key={gi}
                          colSpan={g.count}
                          rowSpan={g.count === 1 ? 2 : 1}
                          className="tt-group-header"
                        >
                          {g.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {columns.map((col, i) =>
                        colGroupCounts[i] === 1 ? null : (
                          <th key={i} className="tt-col-header" title={col.isCondition ? 'condition' : ''}>
                            {col.name}
                          </th>
                        )
                      )}
                    </tr>
                  </>
                );
              })()}
            </thead>
            <tbody>
              {fullSteps.map((row, ri) => {
                const currVal = (name) => {
                  if (name === 'Output') return output;
                  const cv = row.conditions[name];
                  if (cv !== undefined) return cv;
                  return row.vars[name];
                };
                return (
                  <tr key={ri} className={ri % 2 === 0 ? 'tt-row-even' : 'tt-row-odd'}>
                    {colNames.map((name, ci) => {
                      const val = currVal(name);
                      const pv = prevValue(ri, ci);
                      const isCond = isConditionCol(name);
                      const condEval = name in row.conditions;
                      const isLastRow = ri === fullSteps.length - 1;

                      let displayVal;
                      if (name === 'Output') {
                        displayVal = isLastRow && output ? output : '';
                      } else if (isCond) {
                        displayVal = condEval ? val : '';
                      } else {
                        displayVal = (ri === 0 || val !== pv) ? (val ?? '') : '';
                      }

                      let cls = 'tt-cell';
                      if (!displayVal && displayVal !== 0) {
                        cls += ' tt-cell-empty';
                      }
                      if (isCond && displayVal) {
                        cls += displayVal === 'TRUE' ? ' tt-condition-true' : ' tt-condition-false';
                      }
                      if (name === 'Output') cls += ' tt-cell-output';

                      return (
                        <td key={ci} className={cls}>
                          {displayVal}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          !error && (
            <div className="fc-empty">No trace table to display. Edit the code on the left.</div>
          )
        )}
      </div>
    </div>
  );
}
