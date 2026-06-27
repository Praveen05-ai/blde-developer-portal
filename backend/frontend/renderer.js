/**
 * BLDE(DU) EDC — Pure Javascript Dynamic Form Renderer
 * Parses dynamic JSON schemas (instruments) and renders interactive form controls.
 * Implements client-side reactive skip/branching logic and automatic formula calculation evaluations.
 */

export function renderField(field, editData = null, isOnline = true) {
  const val = editData ? editData[field.id] : '';
  let inputHtml = '';

  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

  switch (field.type) {
    case 'text':
      inputHtml = `<input type="text" id="ef_${field.id}" value="${esc(val)}"/>`;
      break;
    case 'number':
      inputHtml = `<input type="number" id="ef_${field.id}" value="${val}" style="width:120px"/>`;
      break;
    case 'date':
      inputHtml = `<input type="date" id="ef_${field.id}" value="${val}"/>`;
      break;
    case 'textarea':
      inputHtml = `<textarea id="ef_${field.id}" rows="3">${val}</textarea>`;
      break;
    case 'radio':
      inputHtml = `
        <div class="radio-grp" id="ef_${field.id}">
          ${(field.options || []).map(o => `
            <label>
              <input type="radio" name="ef_${field.id}" value="${o}" ${val === o ? 'checked' : ''}> ${o}
            </label>
          `).join('')}
        </div>`;
      break;
    case 'select':
      inputHtml = `
        <select id="ef_${field.id}">
          <option value="">—</option>
          ${(field.options || []).map(o => `<option ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>`;
      break;
    case 'checkbox':
      inputHtml = `
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="ef_${field.id}" ${val ? 'checked' : ''}> ${field.label}
        </label>`;
      break;
    case 'calc':
      inputHtml = `<div class="calc-box" id="ef_${field.id}">${val || '—'}</div><div class="calc-note">= ${field.formulaDisplay || field.formula || ''}</div>`;
      break;
    case 'file':
      inputHtml = isOnline 
        ? `<div class="file-drop" onclick="document.getElementById('eff_${field.id}').click()">
             <input type="file" id="eff_${field.id}" style="display:none" accept="${field.accept || '*'}" onchange="handleFile(this,'${field.id}')">
             <div style="font-size:12px;color:var(--tx3)">📎 Click to upload · ${field.accept || 'All types'}</div>
           </div><div id="effl_${field.id}"></div>`
        : `<div style="font-size:11px;color:var(--tx3);padding:6px 0">📎 File upload not available offline</div>`;
      break;
    default:
      inputHtml = `<input type="text" id="ef_${field.id}" value="${esc(val)}"/>`;
  }

  return `
    <div class="erow" id="erow_${field.id}">
      <div class="elabel">${field.label}${field.required ? '<span class="req"> *</span>' : ''}</div>
      <div class="einput">
        ${inputHtml}
        <div class="ferr" id="fe_${field.id}"></div>
      </div>
    </div>`;
}

export function getFieldVal(field) {
  if (field.type === 'radio') {
    const radio = document.querySelector(`input[name="ef_${field.id}"]:checked`);
    return radio ? radio.value : '';
  }
  if (field.type === 'checkbox') {
    const el = document.getElementById('ef_' + field.id);
    return el ? el.checked : false;
  }
  if (field.type === 'calc' || field.type === 'file') {
    return null;
  }
  const el = document.getElementById('ef_' + field.id);
  return el ? el.value : '';
}

export function setupBranchingLogic(field) {
  if (!field.branching) return;
  
  const { field: triggerField, operator, value: triggerVal, action } = field.branching;
  
  function evaluateVisibility() {
    const rch = document.querySelector(`input[name="ef_${triggerField}"]:checked`);
    const dep = document.getElementById('ef_' + triggerField);
    let currentVal = rch ? rch.value : (dep ? dep.value : '');
    
    let isMatch = false;
    if (operator === '=') isMatch = String(currentVal) === String(triggerVal);
    else if (operator === '!=') isMatch = String(currentVal) !== String(triggerVal);
    else if (operator === '>') isMatch = parseFloat(currentVal) > parseFloat(triggerVal);
    else if (operator === '<') isMatch = parseFloat(currentVal) < parseFloat(triggerVal);
    
    const show = (action === 'show' && isMatch) || (action === 'hide' && !isMatch);
    const row = document.getElementById('erow_' + field.id);
    if (row) {
      row.classList.toggle('hf', !show);
    }
  }

  // Bind change events to all trigger field controls
  document.querySelectorAll(`#ef_${triggerField}, input[name="ef_${triggerField}"]`).forEach(el => {
    el.addEventListener('change', evaluateVisibility);
  });
  
  // Initial evaluation
  evaluateVisibility();
}

export function setupCalculationLogic(calcField, allFields) {
  if (!calcField.formula) return;

  function evaluateFormula() {
    const scope = {};
    allFields.forEach(f => {
      if (f.type !== 'calc') {
        const v = parseFloat(getFieldVal(f));
        scope[f.id] = isNaN(v) ? 0 : v;
      }
    });

    try {
      let formula = calcField.formula;
      Object.entries(scope).forEach(([k, v]) => {
        formula = formula.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
      });

      // Security check: restrict formula execution characters
      if (/[^0-9\.\+\-\*\/\(\)\s]/.test(formula)) return;
      
      let calculatedVal = Function('"use strict";return (' + formula + ')')();
      
      if (!isFinite(calculatedVal)) {
        calculatedVal = null;
      } else if (calcField.decimalPlaces !== undefined) {
        calculatedVal = parseFloat(calculatedVal.toFixed(calcField.decimalPlaces));
      }

      const el = document.getElementById('ef_' + calcField.id);
      if (el) {
        el.textContent = calculatedVal !== null ? calculatedVal : '—';
      }
    } catch (e) {
      // Ignore evaluation syntax errors during entry
    }
  }

  // Bind change and input triggers
  allFields.forEach(f => {
    if (f.type !== 'calc' && f.type !== 'file') {
      const el = document.getElementById('ef_' + f.id);
      if (el) el.addEventListener('input', evaluateFormula);
      
      document.querySelectorAll(`input[name="ef_${f.id}"]`).forEach(r => {
        r.addEventListener('change', evaluateFormula);
      });
    }
  });

  // Initial evaluation
  evaluateFormula();
}
