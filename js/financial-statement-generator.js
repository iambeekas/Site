/* Financial Statement Generator — browser-only intake and draft persistence */
(function(){
  'use strict';
  const DRAFT_KEY='bikasb_fsg_draft_v1';
  const $=id=>document.getElementById(id);
  const state={mode:'trial-balance',workbook:null,rows:[],headers:[],headerRow:0,fileName:''};
  const fieldIds=['entityName','entityType','country','currency','periodStart','periodEnd','comparativeStart','comparativeEnd','framework','mCash','mReceivables','mInventory','mPpe','mOtherAssets','mPayables','mLoans','mOtherLiabilities','mOpeningCapital','mCapitalIntroduced','mDrawings','mCapitalAdjustments','mOpeningPartnerCapital','mPartnerContributions','mPartnerDrawings','mPartnerAdjustments','mOpeningEquity','mShareIssues','mDividends','mOtherEquity','mCompCash','mCompReceivables','mCompInventory','mCompPpe','mCompOtherAssets','mCompPayables','mCompLoans','mCompOtherLiabilities','mCompClosingEquity'];
  const numericIds=new Set(fieldIds.filter(id=>id.startsWith('m')));
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{if(v===null||v===undefined||v==='')return 0;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:NaN;};
  const fmt=v=>new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number.isFinite(v)?v:0);
  function readFields(){const o={};fieldIds.forEach(id=>{o[id]=numericIds.has(id)?($(id).value===''?'':$(id).value):$(id).value;});return o;}
  function addEntryRow(target,label='',amount='',comparative=''){
    const row=document.createElement('div');row.className='fsg-entry-row';
    row.innerHTML='<input type="text" class="entry-label" aria-label="Description" placeholder="Description" value="'+escapeHtml(label)+'"><input type="number" class="entry-amount" aria-label="Current period amount" min="0" step="0.01" placeholder="Current" value="'+escapeHtml(amount)+'"><input type="number" class="entry-comparative" aria-label="Comparative period amount" min="0" step="0.01" placeholder="Comparative" value="'+escapeHtml(comparative)+'"><button type="button" class="fsg-remove-row" aria-label="Remove line">×</button>';
    row.querySelector('.fsg-remove-row').addEventListener('click',()=>{row.remove();updateReview();});
    row.querySelectorAll('input').forEach(el=>el.addEventListener('input',updateReview));
    $(target).appendChild(row);
  }
  function readRows(id){return Array.from($(id).querySelectorAll('.fsg-entry-row')).map(r=>({label:r.querySelector('.entry-label').value,amount:r.querySelector('.entry-amount').value,comparativeAmount:r.querySelector('.entry-comparative').value})).filter(x=>x.label.trim()||x.amount!==''||x.comparativeAmount!=='');}
  function writeRows(id,items){$(id).innerHTML='';(items&&items.length?items:[{}]).forEach(x=>addEntryRow(id,x.label||'',x.amount||'',x.comparativeAmount||''));}
  function setMode(mode){
    state.mode=mode;
    document.querySelectorAll('.fsg-mode-card').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('is-selected',active);b.setAttribute('aria-pressed',String(active));});
    $('trialBalancePanel').hidden=mode!=='trial-balance';$('manualPanel').hidden=mode!=='manual';updateReview();
  }
  function detectHeader(matrix){
    let best=0,score=-1;
    matrix.slice(0,20).forEach((row,i)=>{const text=row.map(v=>String(v??'').toLowerCase()).join(' ');let s=0;
      if(/account|ledger|particular|description|name/.test(text))s+=2;
      if(/debit|dr\b/.test(text))s+=2;if(/credit|cr\b/.test(text))s+=2;
      if(/code|number|comparative|previous|prior/.test(text))s+=1;
      if(s>score){score=s;best=i;}
    });
    return best;
  }
  function normalHeader(v){return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function suggest(headers,kind){
    const patterns={
      name:[/account name/,/account description/,/^description$/, /^particulars?$/, /^account$/, /ledger name/],
      code:[/account code/,/ledger code/,/^code$/, /account number/,/^a c$/],
      debit:[/current debit/,/^debit$/, /debit balance/,/^dr$/],
      credit:[/current credit/,/^credit$/, /credit balance/,/^cr$/],
      compDebit:[/comparative debit/,/previous debit/,/prior debit/,/last year debit/],
      compCredit:[/comparative credit/,/previous credit/,/prior credit/,/last year credit/]
    };
    const index=headers.findIndex(h=>patterns[kind].some(p=>p.test(normalHeader(h))));
    return index>=0?String(index):'';
  }
  function populateSelect(id,headers,selected,optional){
    const s=$(id);s.innerHTML='<option value="">'+(optional?'Not provided':'Select column')+'</option>'+headers.map((h,i)=>'<option value="'+i+'">'+escapeHtml(h||('Column '+(i+1)))+'</option>').join('');
    if(selected!==''&&selected!==undefined)s.value=String(selected);
  }
  function parseSelectedSheet(){
    if(!state.workbook)return;
    const sheetName=state.workbook.SheetNames[Number($('tbSheet').value)||0];
    const matrix=XLSX.utils.sheet_to_json(state.workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
    if(!matrix.length){$('fileStatus').textContent='The selected worksheet is empty.';return;}
    state.headerRow=detectHeader(matrix);
    state.headers=(matrix[state.headerRow]||[]).map((v,i)=>String(v||('Column '+(i+1))).trim());
    state.rows=matrix.slice(state.headerRow+1).filter(r=>r.some(v=>String(v??'').trim()!==''));
    const map={name:suggest(state.headers,'name'),code:suggest(state.headers,'code'),debit:suggest(state.headers,'debit'),credit:suggest(state.headers,'credit'),compDebit:suggest(state.headers,'compDebit'),compCredit:suggest(state.headers,'compCredit')};
    populateSelect('colName',state.headers,map.name,false);populateSelect('colCode',state.headers,map.code,true);
    populateSelect('colDebit',state.headers,map.debit,false);populateSelect('colCredit',state.headers,map.credit,false);
    populateSelect('colCompDebit',state.headers,map.compDebit,true);populateSelect('colCompCredit',state.headers,map.compCredit,true);
    $('tbPreview').hidden=true;
    $('fileStatus').textContent=state.fileName+' · '+state.workbook.SheetNames.length+' worksheet(s) · '+sheetName+' selected · '+state.rows.length+' non-empty data row(s) detected.';
    if(!map.name||!map.debit||!map.credit)$('fileStatus').textContent+=' Please select the correct account name, debit and credit columns.';
    state.imported=null;updateReview();
  }
  async function readFile(file){
    if(!window.XLSX){$('fileStatus').textContent='The spreadsheet reader could not load. Refresh the page and try again.';return;}
    state.fileName=file.name;
    try{
      const data=await file.arrayBuffer();
      state.workbook=XLSX.read(data,{type:'array',cellDates:false});
      $('tbSheet').innerHTML=state.workbook.SheetNames.map((name,i)=>'<option value="'+i+'">'+escapeHtml(name)+'</option>').join('');
      $('tbMapping').hidden=false;
      parseSelectedSheet();
    }catch(err){$('fileStatus').textContent='Could not read this file: '+err.message;$('tbMapping').hidden=true;}
  }
  function importTrialBalance(){
    const ix={name:$('colName').value,code:$('colCode').value,debit:$('colDebit').value,credit:$('colCredit').value,compDebit:$('colCompDebit').value,compCredit:$('colCompCredit').value};
    if(ix.name===''||ix.debit===''||ix.credit===''){alert('Select account name, current debit and current credit columns.');return;}
    const imported=[];let invalid=0;
    state.rows.forEach((r,i)=>{
      const name=String(r[Number(ix.name)]??'').trim();if(!name)return;
      const debit=ix.debit===''?0:num(r[Number(ix.debit)]),credit=ix.credit===''?0:num(r[Number(ix.credit)]);
      const cDebit=ix.compDebit===''?0:num(r[Number(ix.compDebit)]),cCredit=ix.compCredit===''?0:num(r[Number(ix.compCredit)]);
      if([debit,credit,cDebit,cCredit].some(v=>!Number.isFinite(v))){invalid++;return;}
      imported.push({row:i+state.headerRow+2,code:ix.code===''?'':String(r[Number(ix.code)]??'').trim(),name,debit,credit,comparativeDebit:cDebit,comparativeCredit:cCredit});
    });
    state.imported=imported;state.invalidRows=invalid;
    const dr=imported.reduce((s,r)=>s+r.debit,0),cr=imported.reduce((s,r)=>s+r.credit,0),cd=imported.reduce((s,r)=>s+r.comparativeDebit,0),cc=imported.reduce((s,r)=>s+r.comparativeCredit,0);
    const currentDiff=dr-cr,compDiff=cd-cc;
    const preview=imported.slice(0,8);
    $('tbPreview').innerHTML='<div style="padding:.8rem 1rem;font-weight:700">Imported preview · '+imported.length+' account row(s)</div><table><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th>Comparative Dr</th><th>Comparative Cr</th></tr></thead><tbody>'+preview.map(r=>'<tr><td>'+escapeHtml((r.code?r.code+' · ':'')+r.name)+'</td><td class="num">'+fmt(r.debit)+'</td><td class="num">'+fmt(r.credit)+'</td><td class="num">'+fmt(r.comparativeDebit)+'</td><td class="num">'+fmt(r.comparativeCredit)+'</td></tr>').join('')+'</tbody></table><div style="padding:.8rem 1rem;font-size:.82rem">Current debit: '+fmt(dr)+' · Credit: '+fmt(cr)+' · Difference: <strong>'+fmt(currentDiff)+'</strong><br>Comparative debit: '+fmt(cd)+' · Credit: '+fmt(cc)+' · Difference: <strong>'+fmt(compDiff)+'</strong>'+(invalid?'<br>Rows excluded due to non-numeric balances: '+invalid:'')+'</div>';
    $('tbPreview').hidden=false;updateReview();saveDraft(true);
  }
  function manualTotals(){
    const income=readRows('incomeRows').reduce((s,x)=>s+(num(x.amount)||0),0);
    const expenses=readRows('expenseRows').reduce((s,x)=>s+(num(x.amount)||0),0);
    const comparativeIncome=readRows('incomeRows').reduce((s,x)=>s+(num(x.comparativeAmount)||0),0);
    const comparativeExpenses=readRows('expenseRows').reduce((s,x)=>s+(num(x.comparativeAmount)||0),0);
    return {income,expenses,profit:income-expenses,comparativeIncome,comparativeExpenses,comparativeProfit:comparativeIncome-comparativeExpenses};
  }
  function updateReview(){
    const box=$('reviewSummary');
    if(state.mode==='trial-balance'&&state.imported){
      const dr=state.imported.reduce((s,r)=>s+r.debit,0),cr=state.imported.reduce((s,r)=>s+r.credit,0);
      const diff=dr-cr;
      box.innerHTML='<div class="fsg-review-grid"><div class="fsg-review-metric"><small>Imported accounts</small><strong>'+state.imported.length+'</strong></div><div class="fsg-review-metric"><small>Total debit</small><strong>'+fmt(dr)+'</strong></div><div class="fsg-review-metric"><small>Total credit</small><strong>'+fmt(cr)+'</strong></div></div><div class="fsg-alert '+(Math.abs(diff)<.005?'ok':'')+'">'+(Math.abs(diff)<.005?'Current trial balance totals agree.':'Trial balance difference: '+fmt(diff)+'. Investigate before proceeding.')+(state.invalidRows?' '+state.invalidRows+' invalid row(s) were excluded.':'')+'</div>';
    }else if(state.mode==='manual'){
      const t=manualTotals();const assets=['mCash','mReceivables','mInventory','mPpe','mOtherAssets'].reduce((s,id)=>s+(num($(id).value)||0),0);
      const liabilities=['mPayables','mLoans','mOtherLiabilities'].reduce((s,id)=>s+(num($(id).value)||0),0);
      const entityType=$('entityType').value;
      const equity=entityType==='sole-trader' ? (num($('mOpeningCapital').value)||0)+(num($('mCapitalIntroduced').value)||0)+t.profit-(num($('mDrawings').value)||0)+(num($('mCapitalAdjustments').value)||0) : entityType==='partnership' ? (num($('mOpeningPartnerCapital').value)||0)+(num($('mPartnerContributions').value)||0)+t.profit-(num($('mPartnerDrawings').value)||0)+(num($('mPartnerAdjustments').value)||0) : (num($('mOpeningEquity').value)||0)+(num($('mShareIssues').value)||0)+t.profit-(num($('mDividends').value)||0)+(num($('mOtherEquity').value)||0);
      box.innerHTML='<div class="fsg-review-grid"><div class="fsg-review-metric"><small>Total income</small><strong>'+fmt(t.income)+'</strong></div><div class="fsg-review-metric"><small>Total expenses</small><strong>'+fmt(t.expenses)+'</strong></div><div class="fsg-review-metric"><small>Indicative profit / (loss)</small><strong>'+fmt(t.profit)+'</strong></div><div class="fsg-review-metric"><small>Comparative profit / (loss)</small><strong>'+fmt(t.comparativeProfit)+'</strong></div><div class="fsg-review-metric"><small>Entered assets</small><strong>'+fmt(assets)+'</strong></div><div class="fsg-review-metric"><small>Entered liabilities</small><strong>'+fmt(liabilities)+'</strong></div><div class="fsg-review-metric"><small>Indicative closing capital / equity</small><strong>'+fmt(equity)+'</strong></div></div><div class="fsg-alert">These are input summaries only. Asset completeness, opening balances, tax, depreciation, accruals and other adjustments have not yet been assessed.</div>';
    }else{box.innerHTML='<p>Choose an input method and provide your figures. The review will show what has been imported and what still needs attention.</p>';}
  }
  function collectDraft(){return {version:1,savedAt:new Date().toISOString(),mode:state.mode,fields:readFields(),income:readRows('incomeRows'),expenses:readRows('expenseRows'),fileName:state.fileName,imported:state.imported||null};}
  function saveDraft(silent){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify(collectDraft()));$('saveState').textContent='Saved on this device · '+new Date().toLocaleTimeString();if(!silent)$('fileStatus').textContent='Draft saved locally in this browser.';}
    catch(e){$('saveState').textContent='Could not save draft';if(!silent)alert('The browser could not save this draft. Check available site storage.');}
  }
  function restoreDraft(){
    try{const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return;const d=JSON.parse(raw);if(d.version!==1)return;
      if(!confirm('A saved Financial Statement Generator draft was found on this device. Would you like to restore it?'))return;
      Object.entries(d.fields||{}).forEach(([id,v])=>{if($(id))$(id).value=v;});
      $('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';
      writeRows('incomeRows',d.income);writeRows('expenseRows',d.expenses);setMode(d.mode||'trial-balance');
      if(d.imported){state.imported=d.imported;$('fileStatus').textContent='Restored imported account data from local draft. Re-upload the original file to change column mappings.';}
      state.fileName=d.fileName||'';$('saveState').textContent='Draft restored from '+new Date(d.savedAt).toLocaleString();updateReview();
    }catch(e){console.warn('Draft restore skipped',e);}
  }
  function clearDraft(){if(!confirm('Clear the saved draft from this browser? This cannot be undone.'))return;localStorage.removeItem(DRAFT_KEY);location.reload();}
  document.querySelectorAll('.fsg-mode-card').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  document.querySelectorAll('[data-add-row]').forEach(b=>b.addEventListener('click',()=>{addEntryRow(b.dataset.addRow);updateReview();}));
  $('tbFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readFile(f);});
  $('tbSheet').addEventListener('change',parseSelectedSheet);
  $('importTbBtn').addEventListener('click',importTrialBalance);
  $('saveDraftBtn').addEventListener('click',()=>saveDraft(false));
  $('clearDraftBtn').addEventListener('click',clearDraft);
  $('entityType').addEventListener('change',()=>{$('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';updateReview();});
  let autosaveTimer;
  function scheduleAutosave(e){if(e.target.closest('.fsg-panel')){updateReview();clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveDraft(true),700);}}
  document.addEventListener('input',scheduleAutosave);document.addEventListener('change',scheduleAutosave);
  ['incomeRows','expenseRows'].forEach(id=>writeRows(id,[{}]));
  setMode('trial-balance');
  restoreDraft();
})();