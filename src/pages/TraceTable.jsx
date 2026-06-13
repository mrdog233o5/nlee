import { useMemo } from 'react';
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

  const exportCSV = () => {
    let csv = colNames.join(',') + '\n';
    for (const row of fullSteps) {
      const vals = colNames.map((name) => {
        if (name === 'Output') return output;
        const condVal = row.conditions[name];
        if (condVal !== undefined) return condVal;
        const varVal = row.vars[name];
        return varVal !== undefined ? varVal : '';
      });
      csv += vals.join(',') + '\n';
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trace-table.csv';
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
          <button className="fc-export-btn" onClick={exportCSV}>
            Export CSV
          </button>
        </div>
      )}

      <div className="tt-wrapper">
        {columns.length > 0 ? (
          <table className="tt-table">
            <thead>
              {(() => {
                const hasOutput = columns.some((c) => c.group === 'output');
                if (!hasOutput) return null;
                const groups = [];
                let currentGroup = columns[0].group;
                let groupStart = 0;
                for (let i = 0; i <= columns.length; i++) {
                  const g = i < columns.length ? columns[i].group : null;
                  if (g !== currentGroup || i === columns.length) {
                    groups.push({ label: currentGroup, count: i - groupStart });
                    currentGroup = g;
                    groupStart = i;
                  }
                }
                return (
                  <tr className="tt-group-row">
                    {groups.map((g, gi) => (
                      <th key={gi} colSpan={g.count} className="tt-group-header">
                        {g.label}
                      </th>
                    ))}
                  </tr>
                );
              })()}

              <tr>
                {columns.map((col, i) => (
                  <th key={i} className="tt-col-header" title={col.isCondition ? 'condition' : ''}>
                    {col.name}
                  </th>
                ))}
              </tr>
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
