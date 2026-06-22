import { useMemo, useState, useCallback } from 'react';
import ExcelJS from 'exceljs';
import { simulateJavaCode } from '../utils/traceTableSimulator';
import { findInputSectionVars } from '../utils/flowchartParser';

// Factorial truth table data — columns 2/3/5 display N/A for now
const TABLE_DATA = {
  columns: [
    { name: 'Input', group: 'Input' },
    { name: 'Abnormal/Extreme/Normal', group: 'Analysis', na: true },
    { name: 'Calculation to predict output', group: 'Analysis', na: true },
    { name: 'Expected Output', group: 'Output' },
    { name: 'Actual Output', group: 'Output', na: true },
  ],
  rows: [
    { Input: '-2147483648' },
    { Input: '0' },
    { Input: '1' },
    { Input: '5' },
    { Input: '12' },
  ],
};

const JAVA_TYPES = 'int|double|float|long|short|byte|boolean|char|String';

/**
 * Inject a new value for a variable declaration in Java source code.
 * Handles both `int x = 0;` and `int x;` patterns.
 */
function injectInputValue(code, varName, value) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Case 1: declaration with initializer — replace the literal
  const withInit = new RegExp(
    `(\\b(?:${JAVA_TYPES})\\s+${escaped}\\s*=\\s*)[^;]+(\\s*;)`
  );
  if (withInit.test(code)) {
    return code.replace(withInit, `$1${value}$2`);
  }

  // Case 2: declaration without initializer — insert value
  const withoutInit = new RegExp(
    `(\\b(?:${JAVA_TYPES})\\s+${escaped})\\s*;`
  );
  if (withoutInit.test(code)) {
    return code.replace(withoutInit, `$1 = ${value};`);
  }

  // Fallback: variable not found, return code unchanged
  return code;
}

export default function TruthTable({ code }) {
  const { columns, rows } = TABLE_DATA;

  // Editable input values — users can type test inputs directly in the table
  const [inputs, setInputs] = useState(() => rows.map((r) => r.Input));

  const colNames = useMemo(() => columns.map((c) => c.name), [columns]);

  // Compute Expected Output by running the simulator for each test input
  const computedOutputs = useMemo(() => {
    if (!code) return null;
    const inputVars = findInputSectionVars(code);
    if (inputVars.size === 0) return null;

    const varName = [...inputVars][0];
    const outputs = {};

    for (let i = 0; i < inputs.length; i++) {
      const inputVal = inputs[i];
      try {
        const rewritten = injectInputValue(code, varName, inputVal);
        const { output, error } = simulateJavaCode(rewritten);
        outputs[i] = error ? `Error: ${error}` : output;
      } catch (e) {
        outputs[i] = `Error: ${e.message}`;
      }
    }
    return outputs;
  }, [code, inputs]);

  const hasData = computedOutputs !== null;

  const handleInputChange = useCallback((ri, text) => {
    setInputs((prev) => {
      const next = [...prev];
      next[ri] = text;
      return next;
    });
  }, []);

  // Column groups — mirrors TraceTable's group computation
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

  // Resolve a cell's display value
  const cellValue = (ri, colName) => {
    const col = columns.find((c) => c.name === colName);
    if (col?.na) return 'N/A';
    if (colName === 'Input') return inputs[ri] ?? '';
    if (colName === 'Expected Output' && computedOutputs && computedOutputs[ri] !== undefined) {
      return computedOutputs[ri];
    }
    return '';
  };

  const exportXLSX = async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Truth Table');
    const nCols = columns.length;

    // Row 1: Group headers
    const groupRow = columns.map((_, i) => {
      const g = groups.find((g) => g.startCol <= i && i < g.startCol + g.count);
      return i === (g ? g.startCol : 0) ? (g ? g.label : '') : '';
    });

    // Row 2: Column headers (skip count=1 groups — merged with row 1)
    const colHeaderRow = columns.map((col, i) =>
      colGroupCounts[i] === 1 ? '' : col.name
    );

    // Row 3+: Data rows
    const dataRows = inputs.map((_, ri) =>
      colNames.map((name) => cellValue(ri, name))
    );

    ws.addRows([groupRow, colHeaderRow, ...dataRows]);

    // Merge cells for group headers
    for (const g of groups) {
      if (g.count === 1) {
        ws.mergeCells(1, g.startCol + 1, 2, g.startCol + 1);
      } else {
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

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'truth-table.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <h2 style={{ display: 'none' }}>Truth Table</h2>

      {hasData && (
        <div className="fc-toolbar">
          <button className="fc-export-btn" onClick={exportXLSX}>
            Export XLSX
          </button>
        </div>
      )}

      <div className="tt-wrapper">
        {hasData ? (
          <table className="tt-table">
            <thead>
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
                    <th key={i} className="tt-col-header">
                      {col.name}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {inputs.map((_, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'tt-row-even' : 'tt-row-odd'}>
                  {colNames.map((name, ci) => {
                    const val = cellValue(ri, name);
                    const col = columns.find((c) => c.name === name);
                    const isNA = col?.na;
                    const isInput = name === 'Input';

                    let cls = 'tt-cell';
                    if (isNA) {
                      cls += ' tt-cell-empty';
                    } else if (name === 'Expected Output') {
                      cls += ' tt-cell-output';
                    }
                    if (isInput) {
                      cls += ' tt-cell-input';
                    }

                    return (
                      <td key={ci} className={cls}>
                        {isInput ? (
                          <span
                            className="tt-input-inner"
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={(e) => {
                              const text = e.currentTarget.textContent || '';
                              handleInputChange(ri, text);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                          >
                            {val}
                          </span>
                        ) : (
                          val
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="fc-empty">No truth table to display. Edit the code on the left.</div>
        )}
      </div>
    </div>
  );
}
