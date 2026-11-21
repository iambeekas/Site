/* Financial Statement Generator — browser-only intake and draft persistence */
(function(){
  'use strict';
  const DRAFT_KEY='bikasb_fsg_draft_v2';
  const PROFILE_KEY='bikasb_fsg_mapping_profiles_v1';
  const $=id=>document.getElementById(id);
  const state={mode:'trial-balance',workbook:null,rows:[],headers:[],headerRow:0,fileName:'',mappings:{},mappingItems:[]};
  const fieldIds=['entityName','entityType','country','currency','periodStart','periodEnd','comparativeStart','comparativeEnd','framework','mainBusinessActivity','mCash','mReceivables','mInventory','mPpe','mOtherAssets','mPayables','mLoans','mOtherLiabilities','mOpeningCapital','mCapitalIntroduced','mDrawings','mCapitalAdjustments','mOpeningPartnerCapital','mPartnerContributions','mPartnerDrawings','mPartnerAdjustments','mOpeningEquity','mShareIssues','mDividends','mOtherEquity','mCompCash','mCompReceivables','mCompInventory','mCompPpe','mCompOtherAssets','mCompPayables','mCompLoans','mCompOtherLiabilities','mCompClosingEquity'];
  const numericIds=new Set(fieldIds.filter(id=>id.startsWith('m')));
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{if(v===null||v===undefined||String(v).trim()==='')return 0;let raw=String(v).trim().replace(/,/g,'');if(/^\(.*\)$/.test(raw))raw='-'+raw.slice(1,-1);raw=raw.replace(/[^0-9.+-]/g,'');if(raw===''||raw==='-'||raw==='+')return NaN;const n=Number(raw);return Number.isFinite(n)?n:NaN;};
  const fmt=v=>new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number.isFinite(v)?v:0);
  function readFields(){const o={};fieldIds.forEach(id=>{o[id]=numericIds.has(id)?($(id).value===''?'':$(id).value):$(id).value;});return o;}
  function addEntryRow(target,label='',amount='',comparative=''){
    const row=document.createElement('div');row.className='fsg-entry-row';
    row.innerHTML='<input type="text" class="entry-label" aria-label="Description" placeholder="Description" value="'+escapeHtml(label)+'"><input type="number" class="entry-amount" aria-label="Current period amount" min="0" step="0.01" placeholder="Current" value="'+escapeHtml(amount)+'"><input type="number" class="entry-comparative" aria-label="Comparative period amount" min="0" step="0.01" placeholder="Comparative" value="'+escapeHtml(comparative)+'"><button type="button" class="fsg-remove-row" aria-label="Remove line">×</button>';
    row.querySelector('.fsg-remove-row').addEventListener('click',()=>{row.remove();updateReview();saveDraft(true);});
    row.querySelectorAll('input').forEach(el=>el.addEventListener('input',updateReview));
    $(target).appendChild(row);
  }
  function readRows(id){return Array.from($(id).querySelectorAll('.fsg-entry-row')).map(r=>({label:r.querySelector('.entry-label').value,amount:r.querySelector('.entry-amount').value,comparativeAmount:r.querySelector('.entry-comparative').value})).filter(x=>x.label.trim()||x.amount!==''||x.comparativeAmount!=='');}
  function writeRows(id,items){$(id).innerHTML='';(items&&items.length?items:[{}]).forEach(x=>addEntryRow(id,x.label||'',x.amount||'',x.comparativeAmount||''));}
  function setMode(mode){
    state.mode=mode;
    document.querySelectorAll('.fsg-mode-card').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('is-selected',active);b.setAttribute('aria-pressed',String(active));});
    $('trialBalancePanel').hidden=mode!=='trial-balance';$('manualPanel').hidden=mode!=='manual';if(mode==='manual')$('mappingPanel').hidden=true;else if(state.imported)renderMappings();updateReview();
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

  const MAP_OPTIONS=[
    ['asset.current.cash','SOFP · Current assets · Cash and cash equivalents'],
    ['asset.current.receivables','SOFP · Current assets · Trade and other receivables'],
    ['asset.current.inventory','SOFP · Current assets · Inventories'],
    ['asset.current.other','SOFP · Current assets · Other current assets'],
    ['asset.noncurrent.ppe','SOFP · Non-current assets · Property, plant and equipment'],
    ['asset.noncurrent.intangible','SOFP · Non-current assets · Intangible assets'],
    ['asset.noncurrent.rou','SOFP · Non-current assets · Right-of-use assets'],
    ['asset.noncurrent.investment','SOFP · Non-current assets · Investment property / investments'],
    ['asset.noncurrent.other','SOFP · Non-current assets · Other non-current assets'],
    ['liability.current.payables','SOFP · Current liabilities · Trade and other payables'],
    ['liability.current.borrowings','SOFP · Current liabilities · Current borrowings / lease liabilities'],
    ['liability.current.provisions','SOFP · Current liabilities · Current provisions'],
    ['liability.current.other','SOFP · Current liabilities · Other current liabilities'],
    ['liability.noncurrent.borrowings','SOFP · Non-current liabilities · Borrowings / lease liabilities'],
    ['liability.noncurrent.provisions','SOFP · Non-current liabilities · Non-current provisions'],
    ['liability.noncurrent.other','SOFP · Non-current liabilities · Other non-current liabilities'],
    ['equity.sharecapital','SOFP · Equity · Share capital'],
    ['equity.premium','SOFP · Equity · Share premium'],
    ['equity.retained','SOFP · Equity · Retained earnings / owner capital'],
    ['equity.reserves','SOFP · Equity · Other reserves'],
    ['pl.revenue','SOPL · Revenue'],
    ['pl.otherincome','SOPL · Other income · Operating'],
    ['pl.costsales','SOPL · Cost of sales'],
    ['pl.employee','SOPL · Employee benefits expense'],
    ['pl.depreciation','SOPL · Depreciation and amortisation'],
    ['pl.impairment','SOPL · Impairment losses'],
    ['pl.otheroperating','SOPL · Other operating expenses'],
    ['pl.investmentincome','SOPL · Investment income · Investing category (subject to assessment)'],
    ['pl.associate','SOPL · Share of profit / loss of associates and joint ventures'],
    ['pl.financeincome','SOPL · Finance income · Classification requires assessment'],
    ['pl.financecost','SOPL · Finance costs · Classification requires assessment'],
    ['pl.tax','SOPL · Income tax expense'],
    ['pl.discontinued','SOPL · Discontinued operations'],
    ['oci.revaluation','SOCI · OCI · Revaluation movements'],
    ['oci.definedbenefit','SOCI · OCI · Defined benefit remeasurements'],
    ['oci.fvoci','SOCI · OCI · Financial assets at FVOCI'],
    ['oci.translation','SOCI · OCI · Foreign currency translation'],
    ['oci.hedging','SOCI · OCI · Cash flow hedges'],
    ['oci.other','SOCI · OCI · Other comprehensive income'],
    ['equity.movement','SOCE · Equity movement (requires supporting detail)'],
    ['unresolved','Unresolved · Requires user classification']
  ];
  function suggestMapping(name,side){
    const n=String(name||'').toLowerCase();
    const rules=[
      [/cash|bank|petty cash|cash equivalent/,'asset.current.cash','high'],
      [/trade receivable|accounts receivable|debtor|sundry debtor/,'asset.current.receivables','high'],
      [/inventory|inventories|stock in hand/,'asset.current.inventory','high'],
      [/property plant|fixed asset|plant and machinery|motor vehicle|furniture|equipment/,'asset.noncurrent.ppe','medium'],
      [/right.of.use|rou asset|lease asset/,'asset.noncurrent.rou','high'],
      [/intangible|goodwill|software licence/,'asset.noncurrent.intangible','medium'],
      [/investment property|long.term investment|investment in associate/,'asset.noncurrent.investment','medium'],
      [/trade payable|accounts payable|creditor|sundry creditor/,'liability.current.payables','high'],
      [/bank loan|loan payable|borrowings|lease liability/,'liability.noncurrent.borrowings','medium'],
      [/provision/,'liability.current.provisions','medium'],
      [/share capital/,'equity.sharecapital','high'],
      [/share premium/,'equity.premium','high'],
      [/retained earning|owner.s capital|capital account/,'equity.retained','high'],
      [/reserve/,'equity.reserves','medium'],
      [/revenue|sales|service income|turnover/,'pl.revenue','high'],
      [/cost of sales|cost of goods|purchases|direct material/,'pl.costsales','medium'],
      [/salary|salaries|wages|employee benefit|staff cost/,'pl.employee','medium'],
      [/depreciation|amortisation|amortization/,'pl.depreciation','high'],
      [/impairment|expected credit loss/,'pl.impairment','medium'],
      [/interest expense|finance cost|borrowing cost/,'pl.financecost','medium'],
      [/interest income|finance income/,'pl.financeincome','medium'],
      [/dividend income|investment income/,'pl.investmentincome','medium'],
      [/income tax|corporation tax|tax expense/,'pl.tax','medium'],
      [/associate|joint venture/,'pl.associate','medium'],
      [/revaluation/,'oci.revaluation','medium'],
      [/foreign exchange translation|currency translation/,'oci.translation','medium'],
      [/hedge reserve|cash flow hedge/,'oci.hedging','medium'],
      [/rent|electricity|utilities|insurance|advertising|office expense|administrative expense/,'pl.otheroperating','low']
    ];
    for(const [re,key,confidence] of rules){if(re.test(n))return {key,confidence};}
    if(side==='income')return {key:'pl.otherincome',confidence:'low'};
    if(side==='expense')return {key:'pl.otheroperating',confidence:'low'};
    return {key:'unresolved',confidence:'low'};
  }
  function manualMappingItems(){
    const items=[];
    readRows('incomeRows').forEach((x,i)=>{if(x.label.trim())items.push({id:'manual-income:'+x.label.trim().toLowerCase(),name:x.label,amount:num(x.amount)||0,comparativeAmount:num(x.comparativeAmount)||0,side:'income'});});
    readRows('expenseRows').forEach((x,i)=>{if(x.label.trim())items.push({id:'manual-expense:'+x.label.trim().toLowerCase(),name:x.label,amount:num(x.amount)||0,comparativeAmount:num(x.comparativeAmount)||0,side:'expense'});});
    const fields=[
      ['mCash','Cash and bank','asset.current.cash'],['mReceivables','Trade receivables','asset.current.receivables'],['mInventory','Inventory','asset.current.inventory'],['mPpe','Property, plant and equipment','asset.noncurrent.ppe'],['mOtherAssets','Other assets','asset.current.other'],['mPayables','Trade payables','liability.current.payables'],['mLoans','Loans and borrowings','liability.noncurrent.borrowings'],['mOtherLiabilities','Other liabilities','liability.current.other']
    ];
    fields.forEach(([id,name,key])=>{if($(id).value!=='')items.push({id:'manual-'+id,name,amount:num($(id).value)||0,side:'balance',preset:key});});
    return items;
  }
  function mappingItemsFromInput(){
    if(state.mode==='trial-balance'&&state.imported)return state.imported.map((r,i)=>({id:'tb:'+(r.code||'')+':'+r.name.trim().toLowerCase(),name:r.name,code:r.code,amount:r.debit-r.credit,comparativeAmount:r.comparativeDebit-r.comparativeCredit,side:'tb'}));
    return manualMappingItems();
  }
  function suggestedIfrs18Category(key){
    const activity=$('mainBusinessActivity').value;
    if(key==='pl.financeincome'||key==='pl.financecost')return activity==='financing'||activity==='both'?'operating':'requires-assessment';
    if(key==='pl.investmentincome'||key==='pl.associate'||key.startsWith('asset.noncurrent.investment'))return activity==='investing'||activity==='both'?'operating':'investing';
    if(key==='pl.tax')return 'income-tax';
    if(key==='pl.discontinued')return 'discontinued';
    if(key.startsWith('pl.'))return 'operating';
    return 'not-applicable';
  }
  const IFRS18_OPTIONS=[['operating','Operating'],['investing','Investing'],['financing','Financing'],['income-tax','Income tax'],['discontinued','Discontinued operations'],['not-applicable','Not applicable'],['requires-assessment','Requires assessment']];
  function mappingSelect(item){
    const suggested=item.preset?{key:item.preset,confidence:'high'}:suggestMapping(item.name,item.side);
    const saved=state.mappings[item.id]||{};
    const selected=saved.key||suggested.key;
    const category=saved.category||suggestedIfrs18Category(selected);
    const options=MAP_OPTIONS.map(([v,l])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+escapeHtml(l)+'</option>').join('');
    const categoryOptions=IFRS18_OPTIONS.map(([v,l])=>'<option value="'+v+'" '+(v===category?'selected':'')+'>'+l+'</option>').join('');
    return {html:'<select class="fsg-map-select" data-map-id="'+escapeHtml(item.id)+'" aria-label="Classification for '+escapeHtml(item.name)+'">'+options+'</select>',categoryHtml:'<select class="fsg-category-select" data-map-id="'+escapeHtml(item.id)+'" aria-label="IFRS 18 category for '+escapeHtml(item.name)+'">'+categoryOptions+'</select>',confidence:saved.confidence||suggested.confidence,approved:!!saved.approved};
  }
  function renderMappings(){
    const items=mappingItemsFromInput();state.mappingItems=items;
    if(!items.length){$('mappingPanel').hidden=true;return;}
    $('mappingPanel').hidden=false;
    const rows=items.map(item=>{
      const m=mappingSelect(item),saved=state.mappings[item.id]||{};
      return '<tr><td>'+escapeHtml((item.code?item.code+' · ':'')+item.name)+'</td><td class="num">'+fmt(item.amount)+'</td><td>'+m.html+'</td><td>'+m.categoryHtml+'</td><td><span class="fsg-confidence '+m.confidence+'">'+m.confidence+'</span></td><td><label class="fsg-approve"><input type="checkbox" class="fsg-map-approved" data-map-id="'+escapeHtml(item.id)+'" '+(m.approved?'checked':'')+'> Approved</label></td></tr>';
    }).join('');
    $('mappingTable').innerHTML='<table><thead><tr><th>Account / input</th><th>Current balance / amount</th><th>Statement line</th><th>IFRS 18 category</th><th>Confidence</th><th>Review</th></tr></thead><tbody>'+rows+'</tbody></table>';$('mappingTable').hidden=false;
    populateSavedProfiles();updateMappingSummary();
  }
  function updateMappingSummary(){
    const items=state.mappingItems||[];let approved=0,unresolved=0;
    items.forEach(item=>{const m=state.mappings[item.id]||{};const suggested=item.preset?item.preset:suggestMapping(item.name,item.side).key;const key=m.key||suggested;if(m.approved)approved++;if(key==='unresolved')unresolved++;});
    $('mappingSummary').innerHTML='<strong>'+items.length+' item(s) to classify</strong><br>'+approved+' approved · '+(items.length-approved)+' awaiting approval · '+unresolved+' unresolved. '+(approved===items.length&&unresolved===0?'All listed mappings have been approved.':'Review each suggestion and approve only after checking the underlying transaction.');
  }
  function handleMappingChange(e){
    const id=e.target.dataset.mapId;if(!id)return;
    const old=state.mappings[id]||{};
    if(e.target.classList.contains('fsg-map-select')){state.mappings[id]={...old,key:e.target.value,approved:false,confidence:'user'};const row=e.target.closest('tr');row.querySelector('.fsg-confidence').textContent='user-selected';row.querySelector('.fsg-confidence').className='fsg-confidence user';row.querySelector('.fsg-map-approved').checked=false;}
    if(e.target.classList.contains('fsg-category-select'))state.mappings[id]={...old,category:e.target.value,approved:false,key:old.key||e.target.closest('tr').querySelector('.fsg-map-select').value};
    if(e.target.classList.contains('fsg-map-approved'))state.mappings[id]={...old,approved:e.target.checked,key:old.key||e.target.closest('tr').querySelector('.fsg-map-select').value,category:old.category||e.target.closest('tr').querySelector('.fsg-category-select').value};
    updateMappingSummary();saveDraft(true);
  }
  function populateSavedProfiles(){
    const select=$('savedMappingProfiles');if(!select)return;
    const profiles=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}');const current=select.value;
    select.innerHTML='<option value="">Choose saved profile</option>'+Object.keys(profiles).map(n=>'<option value="'+escapeHtml(n)+'">'+escapeHtml(n)+'</option>').join('');
    if(profiles[current])select.value=current;
  }
  function saveMappingProfile(){
    const name=($('entityName').value||'Default')+' · '+$('entityType').value+' · '+($('country').value||'');
    try{const profiles=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}');profiles[name]={savedAt:new Date().toISOString(),mappings:state.mappings};localStorage.setItem(PROFILE_KEY,JSON.stringify(profiles));populateSavedProfiles();$('savedMappingProfiles').value=name;$('mappingSummary').insertAdjacentHTML('beforeend','<p class="fsg-alert ok">Mapping profile saved on this device: '+escapeHtml(name)+'</p>');}
    catch(e){alert('Could not save the mapping profile in this browser.');}
  }
  function loadMappingProfile(){
    const name=$('savedMappingProfiles').value;if(!name)return;
    try{const profiles=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}');if(!profiles[name])return;state.mappings={...profiles[name].mappings};renderMappings();saveDraft(true);}
    catch(e){alert('Could not load the selected mapping profile.');}
  }

  function collectDraft(){return {version:2,savedAt:new Date().toISOString(),mode:state.mode,fields:readFields(),income:readRows('incomeRows'),expenses:readRows('expenseRows'),fileName:state.fileName,imported:state.imported||null,mappings:state.mappings};}
  function saveDraft(silent){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify(collectDraft()));$('saveState').textContent='Saved on this device · '+new Date().toLocaleTimeString();if(!silent)$('fileStatus').textContent='Draft saved locally in this browser.';}
    catch(e){$('saveState').textContent='Could not save draft';if(!silent)alert('The browser could not save this draft. Check available site storage.');}
  }
  function restoreDraft(){
    try{const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return;const d=JSON.parse(raw);if(![1,2].includes(d.version))return;
      if(!confirm('A saved Financial Statement Generator draft was found on this device. Would you like to restore it?'))return;
      Object.entries(d.fields||{}).forEach(([id,v])=>{if($(id))$(id).value=v;});
      $('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';
      writeRows('incomeRows',d.income);writeRows('expenseRows',d.expenses);setMode(d.mode||'trial-balance');
      state.mappings=d.mappings||{};
      if(d.imported){state.imported=d.imported;$('fileStatus').textContent='Restored imported account data from local draft. Re-upload the original file to change column mappings.';}
      state.fileName=d.fileName||'';if(state.imported||state.mode==='manual')renderMappings();$('saveState').textContent='Draft restored from '+new Date(d.savedAt).toLocaleString();updateReview();
    }catch(e){console.warn('Draft restore skipped',e);}
  }
  function clearDraft(){if(!confirm('Clear the saved draft from this browser? This cannot be undone.'))return;localStorage.removeItem(DRAFT_KEY);location.reload();}
  document.querySelectorAll('.fsg-mode-card').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  document.querySelectorAll('[data-add-row]').forEach(b=>b.addEventListener('click',()=>{addEntryRow(b.dataset.addRow);updateReview();saveDraft(true);}));
  $('tbFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readFile(f);});
  $('tbSheet').addEventListener('change',parseSelectedSheet);
  $('importTbBtn').addEventListener('click',()=>{importTrialBalance();if(state.imported)renderMappings();});
  $('buildMappingsBtn').addEventListener('click',renderMappings);
  $('manualPrepareMappingsBtn').addEventListener('click',renderMappings);
  $('saveMappingProfileBtn').addEventListener('click',saveMappingProfile);
  $('loadMappingProfileBtn').addEventListener('click',loadMappingProfile);
  $('mappingTable').addEventListener('change',handleMappingChange);
  $('mainBusinessActivity').addEventListener('change',()=>{if(!$('mappingPanel').hidden)renderMappings();});
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