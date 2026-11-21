/* Financial Statement Generator — browser-only intake and draft persistence */
(function(){
  'use strict';
  const DRAFT_KEY='bikasb_fsg_draft_v2';
  const PROFILE_KEY='bikasb_fsg_mapping_profiles_v1';
  const $=id=>document.getElementById(id);
  const state={mode:'trial-balance',workbook:null,rows:[],headers:[],headerRow:0,fileName:'',mappings:{},mappingItems:[]};
  let lastGeneratedReport=null;
  const fieldIds=['entityName','entityType','country','currency','periodStart','periodEnd','comparativeStart','comparativeEnd','framework','tbBasis','mainBusinessActivity','mCash','mReceivables','mInventory','mPpe','mOtherAssets','mPayables','mLoans','mOtherLiabilities','mOpeningCapital','mCapitalIntroduced','mDrawings','mCapitalAdjustments','mOpeningPartnerCapital','mPartnerContributions','mPartnerDrawings','mPartnerAdjustments','mOpeningEquity','mShareIssues','mDividends','mOtherEquity','mCompCash','mCompReceivables','mCompInventory','mCompPpe','mCompOtherAssets','mCompPayables','mCompLoans','mCompOtherLiabilities','mCompClosingEquity'];
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
    readRows('incomeRows').forEach((x,i)=>{if(x.label.trim())items.push({id:'manual-income:'+i+':'+x.label.trim().toLowerCase(),name:x.label,amount:num(x.amount)||0,comparativeAmount:num(x.comparativeAmount)||0,side:'income',sourceType:'income',sourceIndex:i});});
    readRows('expenseRows').forEach((x,i)=>{if(x.label.trim())items.push({id:'manual-expense:'+i+':'+x.label.trim().toLowerCase(),name:x.label,amount:num(x.amount)||0,comparativeAmount:num(x.comparativeAmount)||0,side:'expense',sourceType:'expense',sourceIndex:i});});
    const fields=[
      ['mCash','Cash and bank','asset.current.cash','mCompCash'],['mReceivables','Trade receivables','asset.current.receivables','mCompReceivables'],['mInventory','Inventory','asset.current.inventory','mCompInventory'],['mPpe','Property, plant and equipment','asset.noncurrent.ppe','mCompPpe'],['mOtherAssets','Other assets','asset.current.other','mCompOtherAssets'],['mPayables','Trade payables','liability.current.payables','mCompPayables'],['mLoans','Loans and borrowings','liability.noncurrent.borrowings','mCompLoans'],['mOtherLiabilities','Other liabilities','liability.current.other','mCompOtherLiabilities']
    ];
    fields.forEach(([id,name,key,comparativeId])=>{if($(id).value!==''||$(comparativeId).value!=='')items.push({id:'manual-'+id,name,amount:num($(id).value)||0,comparativeAmount:num($(comparativeId).value)||0,side:'balance',preset:key,sourceType:'field',fieldId:id});});
    return items;
  }
  function mappingItemsFromInput(){
    if(state.mode==='trial-balance'&&state.imported)return state.imported.map((r,i)=>({id:r.mappingId||('tb:'+r.row+':'+(r.code||'')+':'+r.name.trim().toLowerCase()),name:r.name,code:r.code,amount:r.debit-r.credit,comparativeAmount:r.comparativeDebit-r.comparativeCredit,side:'tb',sourceType:'tb',sourceIndex:i}));
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
    const category=$('framework').value==='ifrs18'?(saved.categoryUserSet?saved.category:suggestedIfrs18Category(selected)):'not-applicable';
    const options=MAP_OPTIONS.map(([v,l])=>'<option value="'+v+'" '+(v===selected?'selected':'')+'>'+escapeHtml(l)+'</option>').join('');
    const categoryOptions=IFRS18_OPTIONS.map(([v,l])=>'<option value="'+v+'" '+(v===category?'selected':'')+'>'+l+'</option>').join('');
    return {html:'<select class="fsg-map-select" data-map-id="'+escapeHtml(item.id)+'" aria-label="Classification for '+escapeHtml(item.name)+'">'+options+'</select>',categoryHtml:'<select class="fsg-category-select" data-map-id="'+escapeHtml(item.id)+'" aria-label="IFRS 18 category for '+escapeHtml(item.name)+'" '+($('framework').value==='ifrs18'?'':'disabled')+'>'+categoryOptions+'</select>',confidence:saved.confidence||suggested.confidence,approved:!!saved.approved};
  }
  function renderMappings(){
    const items=mappingItemsFromInput();state.mappingItems=items;
    if(!items.length){$('mappingPanel').hidden=true;return;}
    $('mappingPanel').hidden=false;
    const rows=items.map(item=>{
      const m=mappingSelect(item),saved=state.mappings[item.id]||{};
      return '<tr><td>'+escapeHtml((item.code?item.code+' · ':'')+item.name)+'</td><td class="num">'+fmt(item.amount)+'</td><td>'+m.html+'</td><td>'+m.categoryHtml+'</td><td><span class="fsg-confidence '+m.confidence+'">'+m.confidence+'</span></td><td><label class="fsg-approve"><input type="checkbox" class="fsg-map-approved" data-map-id="'+escapeHtml(item.id)+'" '+(m.approved?'checked':'')+'> Approved</label></td><td><button type="button" class="fsg-row-remove" data-remove-map-id="'+escapeHtml(item.id)+'" aria-label="Remove '+escapeHtml(item.name)+' from mapping">Remove</button></td></tr>';
    }).join('');
    $('mappingTable').innerHTML='<table><thead><tr><th>Account / input</th><th>Current balance / amount</th><th>Statement line</th><th>IFRS 18 category</th><th>Confidence</th><th>Review</th><th>Action</th></tr></thead><tbody>'+rows+'</tbody></table>';$('mappingTable').hidden=false;
    $('addTbMappingRowBtn').hidden=state.mode!=='trial-balance';
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
    if(e.target.classList.contains('fsg-map-select')){state.mappings[id]={...old,key:e.target.value,category:suggestedIfrs18Category(e.target.value),categoryUserSet:false,approved:false,confidence:'user'};const row=e.target.closest('tr');row.querySelector('.fsg-confidence').textContent='user-selected';row.querySelector('.fsg-confidence').className='fsg-confidence user';row.querySelector('.fsg-map-approved').checked=false;}
    if(e.target.classList.contains('fsg-category-select'))state.mappings[id]={...old,category:e.target.value,categoryUserSet:true,approved:false,key:old.key||e.target.closest('tr').querySelector('.fsg-map-select').value};
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


  function approveAllMappings(){
    const items=state.mappingItems||[];
    const unresolved=items.filter(item=>{const m=state.mappings[item.id]||{};const key=m.key||(item.preset||suggestMapping(item.name,item.side).key);return key==='unresolved';});
    if(unresolved.length){alert(unresolved.length+' item(s) are still unresolved. Classify those first. Other mapped items will be approved.');}
    if(!items.length)return;
    if(!confirm('Approve all '+(items.length-unresolved.length)+' currently classified item(s)? Please do this only after reviewing the suggested mappings.'))return;
    items.forEach(item=>{const old=state.mappings[item.id]||{};const key=old.key||item.preset||suggestMapping(item.name,item.side).key;if(key!=='unresolved')state.mappings[item.id]={...old,key,approved:true,category:old.category||suggestedIfrs18Category(key)};});
    renderMappings();saveDraft(true);
  }
  function removeMappingItem(id){
    const item=(state.mappingItems||[]).find(x=>x.id===id);if(!item)return;
    if(!confirm('Remove "'+item.name+'" from the imported / entered data? This changes the source figures used in later calculations.'))return;
    if(item.sourceType==='tb'){state.imported.splice(item.sourceIndex,1);}
    else if(item.sourceType==='income'||item.sourceType==='expense'){
      const list=readRows(item.sourceType==='income'?'incomeRows':'expenseRows');list.splice(item.sourceIndex,1);writeRows(item.sourceType==='income'?'incomeRows':'expenseRows',list);
      Object.keys(state.mappings).filter(k=>k.startsWith('manual-'+item.sourceType+':')).forEach(k=>delete state.mappings[k]);
    }else if(item.sourceType==='field'){$(item.fieldId).value='';delete state.mappings[id];}
    delete state.mappings[id];renderMappings();updateReview();saveDraft(true);
  }
  function addTbMappingItem(){
    const name=$('newTbName').value.trim();if(!name){alert('Enter an account name.');$('newTbName').focus();return;}
    const vals=['newTbDebit','newTbCredit','newTbCompDebit','newTbCompCredit'].map(id=>$(id).value===''?0:num($(id).value));
    if(vals.some(v=>!Number.isFinite(v))){alert('Enter valid numeric balances.');return;}
    if(!state.imported)state.imported=[];
    const nextIndex=state.imported.reduce((m,r)=>Math.max(m,Number(r.row)||0),0)+1;
    const row={row:nextIndex,code:$('newTbCode').value.trim(),name,debit:vals[0],credit:vals[1],comparativeDebit:vals[2],comparativeCredit:vals[3],mappingId:'tb-added-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)};
    state.imported.push(row);
    ['newTbCode','newTbName','newTbDebit','newTbCredit','newTbCompDebit','newTbCompCredit'].forEach(id=>$(id).value='');
    $('addTbMappingRow').hidden=true;renderMappings();updateReview();saveDraft(true);
  }


  const STATEMENT_GROUPS={
    assets:[
      ['asset.current.cash','Cash and cash equivalents'],['asset.current.receivables','Trade and other receivables'],['asset.current.inventory','Inventories'],['asset.current.other','Other current assets'],
      ['asset.noncurrent.ppe','Property, plant and equipment'],['asset.noncurrent.intangible','Intangible assets'],['asset.noncurrent.rou','Right-of-use assets'],['asset.noncurrent.investment','Investment property and investments'],['asset.noncurrent.other','Other non-current assets']
    ],
    liabilities:[
      ['liability.current.payables','Trade and other payables'],['liability.current.borrowings','Current borrowings and lease liabilities'],['liability.current.provisions','Current provisions'],['liability.current.other','Other current liabilities'],
      ['liability.noncurrent.borrowings','Non-current borrowings and lease liabilities'],['liability.noncurrent.provisions','Non-current provisions'],['liability.noncurrent.other','Other non-current liabilities']
    ],
    equity:[
      ['equity.sharecapital','Share capital'],['equity.premium','Share premium'],['equity.retained','Retained earnings / owner capital'],['equity.reserves','Other reserves']
    ],
    income:[
      ['pl.revenue','Revenue'],['pl.otherincome','Other operating income'],['pl.investmentincome','Investment income'],['pl.associate','Share of profit / (loss) of associates and joint ventures'],['pl.financeincome','Finance income']
    ],
    expenses:[
      ['pl.costsales','Cost of sales'],['pl.employee','Employee benefits expense'],['pl.depreciation','Depreciation and amortisation'],['pl.impairment','Impairment losses'],['pl.otheroperating','Other operating expenses'],['pl.financecost','Finance costs'],['pl.tax','Income tax expense'],['pl.discontinued','Discontinued operations']
    ],
    oci:[
      ['oci.revaluation','Revaluation movements'],['oci.definedbenefit','Defined benefit remeasurements'],['oci.fvoci','Financial assets at FVOCI'],['oci.translation','Foreign currency translation'],['oci.hedging','Cash flow hedges'],['oci.other','Other comprehensive income']
    ]
  };
  function mappedKey(item){const saved=state.mappings[item.id]||{};return saved.key||(item.preset||suggestMapping(item.name,item.side).key);}
  function signedStatementAmount(item,key,period){
    const raw=period==='comparative'?(item.comparativeAmount||0):(item.amount||0);
    if(item.sourceType!=='tb')return raw;
    if(key.startsWith('asset.'))return raw;
    if(key.startsWith('liability.')||key.startsWith('equity.'))return -raw;
    if(key.startsWith('pl.')&&['pl.costsales','pl.employee','pl.depreciation','pl.impairment','pl.otheroperating','pl.financecost','pl.tax','pl.discontinued'].includes(key))return raw;
    return -raw;
  }
  function aggregateMappings(period){
    const sums={};Object.values(STATEMENT_GROUPS).flat().forEach(([key])=>sums[key]=0);
    (state.mappingItems||[]).forEach(item=>{
      const key=mappedKey(item);if(Object.prototype.hasOwnProperty.call(sums,key))sums[key]+=signedStatementAmount(item,key,period);
    });
    return sums;
  }
  function manualStatementData(period){
    const sums=aggregateMappings(period),t=manualTotals(),comp=period==='comparative';
    const income=sumGroup(sums,'income'),expenses=sumGroup(sums,'expenses'),profit=income-expenses;
    const value=id=>num($(id).value)||0;
    let equity=0;
    if(comp) equity=value('mCompClosingEquity');
    else if($('entityType').value==='sole-trader') equity=value('mOpeningCapital')+value('mCapitalIntroduced')+profit-value('mDrawings')+value('mCapitalAdjustments');
    else if($('entityType').value==='partnership') equity=value('mOpeningPartnerCapital')+value('mPartnerContributions')+profit-value('mPartnerDrawings')+value('mPartnerAdjustments');
    else equity=value('mOpeningEquity')+value('mShareIssues')+profit-value('mDividends')+value('mOtherEquity');
    sums['equity.retained']=equity;
    return sums;
  }
  function sumGroup(sums,group){return STATEMENT_GROUPS[group].reduce((n,[key])=>n+(sums[key]||0),0);}
  function periodTotals(period){
    if(state.mode==='manual'){
      const sums=manualStatementData(period);
      const income=sumGroup(sums,'income'),expenses=sumGroup(sums,'expenses');
      return {sums,assets:sumGroup(sums,'assets'),liabilities:sumGroup(sums,'liabilities'),equity:sumGroup(sums,'equity'),income,expenses,profit:income-expenses,oci:sumGroup(sums,'oci'),comprehensive:income-expenses+sumGroup(sums,'oci')};
    }
    const sums=aggregateMappings(period);
    const income=sumGroup(sums,'income'),expenses=sumGroup(sums,'expenses');
    const profit=income-expenses;
    const basis=$('tbBasis').value;
    const equity=sumGroup(sums,'equity')+(basis==='pre-closing'?profit:0);
    return {sums,assets:sumGroup(sums,'assets'),liabilities:sumGroup(sums,'liabilities'),equity,income,expenses,profit,oci:sumGroup(sums,'oci'),comprehensive:profit+sumGroup(sums,'oci')};
  }
  function statementRows(sums,group){return STATEMENT_GROUPS[group].filter(([key])=>Math.abs(sums[key]||0)>=0.005).map(([key,label])=>({label,value:sums[key]||0}));}
  function statementTable(title,rows,currentTotal,comparativeTotal,includeTotals=true){
    const c=!!$('comparativeEnd').value || (state.mode==='trial-balance'&&!!state.imported&&state.imported.some(r=>r.comparativeDebit||r.comparativeCredit)) || (state.mode==='manual'&&(['mCompCash','mCompReceivables','mCompInventory','mCompPpe','mCompOtherAssets','mCompPayables','mCompLoans','mCompOtherLiabilities','mCompClosingEquity'].some(id=>$(id).value!=='')||readRows('incomeRows').some(x=>x.comparativeAmount!=='')||readRows('expenseRows').some(x=>x.comparativeAmount!=='')));
    return '<article class="fsg-statement-card"><h3>'+escapeHtml(title)+'</h3><table><thead><tr><th>Particulars</th><th>Current period</th>'+(c?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+
      rows.map(r=>'<tr class="'+(r.subtotal?'subtotal':'')+'"><td>'+escapeHtml(r.label)+'</td><td>'+fmt(r.current)+'</td>'+(c?'<td>'+fmt(r.comparative)+'</td>':'')+'</tr>').join('')+
      (includeTotals?'<tr class="total"><td>Total</td><td>'+fmt(currentTotal)+'</td>'+(c?'<td>'+fmt(comparativeTotal)+'</td>':'')+'</tr>':'')+
      '</tbody></table></article>';
  }
  function renderPeriodRows(current,comparative,group){
    const keys=STATEMENT_GROUPS[group];
    return keys.filter(([key])=>Math.abs(current.sums[key]||0)>=0.005||Math.abs(comparative.sums[key]||0)>=0.005)
      .map(([key,label])=>({label,current:current.sums[key]||0,comparative:comparative.sums[key]||0}));
  }

  const NOTE_TEXT_KEYS=['principalActivities','basisPreparation','goingConcern','currencyPolicy','policyRevenue','policyPpe','policyInventory','policyLeases','policyFinancialInstruments','policyProvisions','policyEmployeeBenefits','policyTax','judgements','estimationUncertainty','provisionDetails','revenueDisaggregation','inventoryDetails','receivablesDetails','borrowingsDetails','leaseDetails','relatedParties','commitmentsContingencies','subsequentEvents','capitalManagement','dividends'];
  const NOTE_SCHEDULES={ppe:['opening','additions','disposals','depreciation','impairment','other','closing'],provisions:['opening','additions','utilised','reversed','other','closing']};
  function readNotes(){
    const out={text:{},schedules:{ppe:{current:{},comparative:{}},provisions:{current:{},comparative:{}}}};
    document.querySelectorAll('[data-note-text]').forEach(input=>out.text[input.dataset.noteText]=input.value);
    document.querySelectorAll('[data-note-schedule]').forEach(input=>{
      const schedule=input.dataset.noteSchedule,period=input.dataset.notePeriod,key=input.dataset.noteKey;
      out.schedules[schedule][period][key]=input.value;
    });
    return out;
  }
  function renderNotes(saved){
    const data=saved||{text:{},schedules:{}};
    document.querySelectorAll('[data-note-text]').forEach(input=>input.value=data.text&&data.text[input.dataset.noteText]!=null?data.text[input.dataset.noteText]:'');
    document.querySelectorAll('[data-note-schedule]').forEach(input=>{
      const schedule=input.dataset.noteSchedule,period=input.dataset.notePeriod,key=input.dataset.noteKey;
      input.value=data.schedules&&data.schedules[schedule]&&data.schedules[schedule][period]&&data.schedules[schedule][period][key]!=null?data.schedules[schedule][period][key]:'';
    });
  }
  function noteText(value){
    const clean=String(value||'').trim();
    return clean?'<p>'+escapeHtml(clean).replace(/\n/g,'<br>')+'</p>':'<p class="fsg-note-missing">Not provided — assess and complete if applicable.</p>';
  }
  function noteScheduleTable(title,schedule,comparativeProvided,sofpBalance,comparativeSofpBalance){
    const data=readNotes().schedules[schedule],keys=NOTE_SCHEDULES[schedule];
    const labels=schedule==='ppe'?{opening:'Opening carrying amount',additions:'Additions',disposals:'Disposals',depreciation:'Depreciation',impairment:'Impairment',other:'Other movements',closing:'Closing carrying amount'}:{opening:'Opening balance',additions:'Additions',utilised:'Amounts utilised',reversed:'Reversals',other:'Other movements',closing:'Closing balance'};
    const calc=period=>{
      const x=data[period],v=k=>num(x[k])||0;
      const expected=schedule==='ppe'?v('opening')+v('additions')-v('disposals')-v('depreciation')-v('impairment')+v('other'):v('opening')+v('additions')-v('utilised')-v('reversed')+v('other');
      const entered=x.closing===''?null:num(x.closing);
      const any=keys.some(k=>x[k]!=='');
      return {expected,entered,any,difference:entered===null?null:entered-expected};
    };
    const c=calc('current'),p=calc('comparative');
    if(!c.any&&(!comparativeProvided||!p.any))return '';
    const rows=keys.map(k=>'<tr><td>'+labels[k]+'</td><td>'+((data.current[k]??'')===''?'—':fmt(num(data.current[k])||0))+'</td>'+(comparativeProvided?'<td>'+((data.comparative[k]??'')===''?'—':fmt(num(data.comparative[k])||0))+'</td>':'')+'</tr>').join('');
    let check='<p class="fsg-period-note">Current movement check: expected closing balance '+fmt(c.expected)+(c.entered===null?'; closing amount not entered.':'; entered closing balance '+fmt(c.entered)+'; difference '+fmt(c.difference)+'.')+'</p>';
    if(comparativeProvided&&p.any)check+='<p class="fsg-period-note">Comparative movement check: expected closing balance '+fmt(p.expected)+(p.entered===null?'; closing amount not entered.':'; entered closing balance '+fmt(p.entered)+'; difference '+fmt(p.difference)+'.')+'</p>';
    if(c.entered!==null)check+='<p class="fsg-period-note">Current SOFP balance: '+fmt(sofpBalance)+'. Difference to entered note closing balance: '+fmt(c.entered-sofpBalance)+'.</p>';
    if(comparativeProvided&&p.entered!==null)check+='<p class="fsg-period-note">Comparative SOFP balance: '+fmt(comparativeSofpBalance)+'. Difference to entered note closing balance: '+fmt(p.entered-comparativeSofpBalance)+'.</p>';
    return '<article class="fsg-statement-card"><h4>'+title+'</h4><table><thead><tr><th>Movement</th><th>Current period</th>'+(comparativeProvided?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table>'+check+'</article>';
  }
  function linkedNoteTable(title,group,current,comparative,comparativeProvided){
    const rows=STATEMENT_GROUPS[group].filter(([key])=>Math.abs(current.sums[key]||0)>=0.005||Math.abs(comparative.sums[key]||0)>=0.005);
    if(!rows.length)return '';
    return '<article class="fsg-statement-card"><h4>'+title+'</h4><table><thead><tr><th>Particulars</th><th>Current period</th>'+(comparativeProvided?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+rows.map(([key,label])=>'<tr><td>'+escapeHtml(label)+'</td><td>'+fmt(current.sums[key]||0)+'</td>'+(comparativeProvided?'<td>'+fmt(comparative.sums[key]||0)+'</td>':'')+'</tr>').join('')+'</tbody></table></article>';
  }
  function notesOutput(current,comparative,comparativeProvided){
    const t=readNotes().text,entity=escapeHtml($('entityName').value||'Not specified'),country=escapeHtml($('country').value||'Not specified'),currency=escapeHtml($('currency').value||''),type=escapeHtml($('entityType').selectedOptions[0].textContent),framework=$('framework').value==='ifrs18'?'IFRS 18 (as selected)':'IAS 1 (as selected)';
    const policies=[['Revenue recognition','policyRevenue'],['Property, plant and equipment','policyPpe'],['Inventory','policyInventory'],['Leases','policyLeases'],['Financial instruments and impairment','policyFinancialInstruments'],['Provisions and contingencies','policyProvisions'],['Employee benefits','policyEmployeeBenefits'],['Income taxes','policyTax']];
    const other=[['Significant management judgements','judgements'],['Key sources of estimation uncertainty','estimationUncertainty'],['Revenue disaggregation','revenueDisaggregation'],['Inventory write-downs and restrictions','inventoryDetails'],['Receivables, credit risk and impairment','receivablesDetails'],['Borrowings, liquidity and security','borrowingsDetails'],['Lease commitments and arrangements','leaseDetails'],['Related-party relationships and transactions','relatedParties'],['Commitments and contingent liabilities / assets','commitmentsContingencies'],['Events after the reporting period','subsequentEvents'],['Capital management and restrictions','capitalManagement'],['Dividends / distributions','dividends']];
    const policyHtml=policies.map(([label,key])=>'<div class="fsg-note-text-block"><strong>'+label+'</strong>'+noteText(t[key])+'</div>').join('');
    const otherHtml=other.map(([label,key])=>'<div class="fsg-note-text-block"><strong>'+label+'</strong>'+noteText(t[key])+'</div>').join('');
    const missing=NOTE_TEXT_KEYS.filter(k=>!String(t[k]||'').trim()).length;
    $('notesStatus').innerHTML='<strong>Notes generated.</strong> '+(NOTE_TEXT_KEYS.length-missing)+' of '+NOTE_TEXT_KEYS.length+' narrative fields completed. '+missing+' fields remain blank; determine which are applicable and complete or mark them not applicable. This is not a completeness or compliance assessment.';
    return '<section class="fsg-notes-output"><h3>Notes to the Financial Statements</h3>'+
      '<p class="fsg-period-note">Entity: '+entity+' · Entity type: '+type+' · Jurisdiction: '+country+' · Presentation currency: '+currency+' · Framework selected: '+framework+'</p>'+
      '<article class="fsg-statement-card"><h4>1. Entity information and basis of preparation</h4><div class="fsg-note-text-block"><strong>Principal activities and nature of operations</strong>'+noteText(t.principalActivities)+'</div><div class="fsg-note-text-block"><strong>Basis of preparation and statement of compliance</strong>'+noteText(t.basisPreparation)+'</div><div class="fsg-note-text-block"><strong>Going concern assessment</strong>'+noteText(t.goingConcern)+'</div><div class="fsg-note-text-block"><strong>Functional and presentation currency</strong>'+noteText(t.currencyPolicy)+'</div></article>'+
      '<article class="fsg-statement-card"><h4>2. Material accounting policy information</h4>'+policyHtml+'</article>'+
      '<article class="fsg-statement-card"><h4>3. Statement line-item analyses</h4>'+linkedNoteTable('Assets','assets',current,comparative,comparativeProvided)+linkedNoteTable('Liabilities','liabilities',current,comparative,comparativeProvided)+linkedNoteTable('Equity','equity',current,comparative,comparativeProvided)+linkedNoteTable('Income','income',current,comparative,comparativeProvided)+linkedNoteTable('Expenses','expenses',current,comparative,comparativeProvided)+linkedNoteTable('Other comprehensive income','oci',current,comparative,comparativeProvided)+'</article>'+
      noteScheduleTable('4. Property, plant and equipment','ppe',comparativeProvided,current.sums['asset.noncurrent.ppe']||0,comparative.sums['asset.noncurrent.ppe']||0)+
      noteScheduleTable('5. Provisions','provisions',comparativeProvided,current.sums['liability.current.provisions']+current.sums['liability.noncurrent.provisions'],comparative.sums['liability.current.provisions']+comparative.sums['liability.noncurrent.provisions'])+'<article class="fsg-statement-card"><h4>Provision nature, timing and uncertainty</h4>'+noteText(t.provisionDetails)+'</article>'+
      '<article class="fsg-statement-card"><h4>6. Significant judgements and estimation uncertainty</h4><div class="fsg-note-text-block"><strong>Significant management judgements</strong>'+noteText(t.judgements)+'</div><div class="fsg-note-text-block"><strong>Key sources of estimation uncertainty</strong>'+noteText(t.estimationUncertainty)+'</div></article>'+
      '<article class="fsg-statement-card"><h4>7. Other entity-specific disclosures</h4>'+otherHtml+'</article>'+
      '<p class="fsg-period-note">The linked statement analyses are generated from approved account mappings. Narrative disclosures and movement schedules are user-prepared. Review materiality, aggregation, disaggregation, comparative information, statutory requirements and all applicable IFRS / local-framework disclosures before issue. This generator does not determine which disclosures are mandatory for a particular entity.</p></section>';
  }

  function generateStatements(){
    if(state.mode==='trial-balance'&&!state.imported){$('statementStatus').innerHTML='<div class="fsg-statement-check error">Import a trial balance before generating statements.</div>';return;}
    if(state.mode==='trial-balance'){
      const items=mappingItemsFromInput();state.mappingItems=items;
      const pending=items.filter(item=>!(state.mappings[item.id]||{}).approved||mappedKey(item)==='unresolved');
      if(pending.length){$('statementStatus').innerHTML='<div class="fsg-statement-check error">'+pending.length+' account(s) are unresolved or not approved. Approve and classify every account before generating statements.</div>';return;}
      const currentDr=state.imported.reduce((s,r)=>s+r.debit,0),currentCr=state.imported.reduce((s,r)=>s+r.credit,0);
      const compDr=state.imported.reduce((s,r)=>s+r.comparativeDebit,0),compCr=state.imported.reduce((s,r)=>s+r.comparativeCredit,0);
      if(Math.abs(currentDr-currentCr)>=0.005){$('statementStatus').innerHTML='<div class="fsg-statement-check error">The current trial balance is out by '+fmt(currentDr-currentCr)+'. Correct the trial balance before generating statements.</div>';return;}
      if(($('comparativeEnd').value||state.imported.some(r=>r.comparativeDebit||r.comparativeCredit))&&Math.abs(compDr-compCr)>=0.005){$('statementStatus').innerHTML='<div class="fsg-statement-check error">The comparative trial balance is out by '+fmt(compDr-compCr)+'. Correct it or remove incomplete comparative figures.</div>';return;}
    }else{
      const items=mappingItemsFromInput();state.mappingItems=items;
      const missing=items.filter(item=>!(state.mappings[item.id]||{}).approved||mappedKey(item)==='unresolved');
      if(missing.length){$('statementStatus').innerHTML='<div class="fsg-statement-check error">'+missing.length+' manual line(s) still need classification approval.</div>';return;}
    }
    const current=periodTotals('current'),comparative=periodTotals('comparative');
    const comparativeProvided=!!$('comparativeEnd').value||state.mode==='trial-balance'&&state.imported.some(r=>r.comparativeDebit||r.comparativeCredit)||state.mode==='manual'&&(['mCompCash','mCompReceivables','mCompInventory','mCompPpe','mCompOtherAssets','mCompPayables','mCompLoans','mCompOtherLiabilities','mCompClosingEquity'].some(id=>$(id).value!=='')||readRows('incomeRows').some(x=>x.comparativeAmount!=='')||readRows('expenseRows').some(x=>x.comparativeAmount!==''));
    const cDiff=current.assets-current.liabilities-current.equity, pDiff=comparative.assets-comparative.liabilities-comparative.equity;
    const currentRows=[
      ...renderPeriodRows(current,comparative,'assets').map(x=>({...x,label:'Assets · '+x.label})),
      {label:'Total assets',current:current.assets,comparative:comparative.assets,subtotal:true},
      ...renderPeriodRows(current,comparative,'liabilities').map(x=>({...x,label:'Liabilities · '+x.label})),
      {label:'Total liabilities',current:current.liabilities,comparative:comparative.liabilities,subtotal:true},
      ...renderPeriodRows(current,comparative,'equity').map(x=>({...x,label:'Equity · '+x.label})),
      ...(state.mode==='trial-balance'&&$('tbBasis').value==='pre-closing'?[{label:'Current period profit / (loss)',current:current.profit,comparative:comparative.profit}]:[]),
      {label:'Total equity',current:current.equity,comparative:comparative.equity,subtotal:true},
      {label:'Total liabilities and equity',current:current.liabilities+current.equity,comparative:comparative.liabilities+comparative.equity,subtotal:true}
    ];
    const plRows=[
      ...renderPeriodRows(current,comparative,'income').map(x=>({...x,label:'Income · '+x.label})),
      {label:'Total income',current:current.income,comparative:comparative.income,subtotal:true},
      ...renderPeriodRows(current,comparative,'expenses').map(x=>({...x,label:'Expense · '+x.label})),
      {label:'Total expenses',current:current.expenses,comparative:comparative.expenses,subtotal:true},
      {label:'Profit / (loss) for the period',current:current.profit,comparative:comparative.profit,subtotal:true}
    ];
    const ociRows=renderPeriodRows(current,comparative,'oci');
    ociRows.unshift({label:'Profit / (loss) for the period',current:current.profit,comparative:comparative.profit});
    ociRows.push({label:'Other comprehensive income',current:current.oci,comparative:comparative.oci,subtotal:true},{label:'Total comprehensive income',current:current.comprehensive,comparative:comparative.comprehensive,subtotal:true});
    const checks=[];
    checks.push({kind:Math.abs(cDiff)<0.005?'ok':'warn',text:'Current statement of financial position difference (assets less liabilities and equity): '+fmt(cDiff)+(Math.abs(cDiff)<0.005?' — balances.':' — does not balance; investigate missing balances, classifications or closing entries.')});
    if(comparativeProvided)checks.push({kind:Math.abs(pDiff)<0.005?'ok':'warn',text:'Comparative statement of financial position difference: '+fmt(pDiff)+(Math.abs(pDiff)<0.005?' — balances.':' — does not balance; investigate comparative balances and closing entries.')});
    if(state.mode==='manual'&&$('entityType').value==='company')checks.push({kind:'warn',text:'Company equity is a summary reconciliation only. A full statement of changes in equity needs movements by component and reserve.'});
    if(state.mode==='manual'&&comparativeProvided&&$('mCompClosingEquity').value==='')checks.push({kind:'warn',text:'Comparative closing equity was not entered; the comparative statement of financial position may be incomplete.'});
    checks.push({kind:'warn',text:'OCI is included only where you mapped period movement accounts to OCI. Closing reserve balances must not be treated as current-period OCI movements.'});
    checks.push({kind:'warn',text:'Tax reconciliation is presented separately and does not automatically replace the tax expense in the source data. Confirm local tax law, deferred tax recognition and any tax balances before finalisation. Note disclosures and Excel export remain under development.'});
    const output=taxReconciliationTable(current,comparative,comparativeProvided)+cashFlowTable(current,comparative,comparativeProvided)+soceOutput(current,comparative,comparativeProvided)+notesOutput(current,comparative,comparativeProvided)+statementTable('Statement of Financial Position',currentRows,current.assets,comparative.assets,false)+
      statementTable('Statement of Profit or Loss',plRows,current.profit,comparative.profit,false)+
      statementTable('Statement of Comprehensive Income',ociRows,current.comprehensive,comparative.comprehensive,false)+
      '<div class="fsg-statement-card"><h3>Validation checks</h3><div class="fsg-statement-checks">'+checks.map(x=>'<div class="fsg-statement-check '+x.kind+'">'+escapeHtml(x.text)+'</div>').join('')+'</div><p class="fsg-period-note">A balanced statement is a mathematical check only; it is not evidence of IFRS compliance or completeness.</p></div>';
    lastGeneratedReport={current,comparative,comparativeProvided,currentRows,plRows,ociRows,cDiff,pDiff};
    $('statementOutput').innerHTML=output;$('statementOutput').hidden=false;
    $('exportExcelBtn').disabled=false;$('exportStatus').textContent='Statements generated. Your workbook is ready to export.';
    $('statementStatus').innerHTML='<strong>Working statements generated.</strong> '+(comparativeProvided?'Current and comparative figures are displayed.':'Current-period figures are displayed; comparative data was not detected.')+' Review the validation checks and source mappings.';
    $('statementOutput').scrollIntoView({behavior:'smooth',block:'start'});
  }



  const TAX_KEYS=['taxRate','nonDeductible','nonTaxable','otherAdjustments','currentTaxOverride','openingDTA','closingDTA','openingDTL','closingDTL','deferredOutsidePL'];
  function readTax(){
    const out={current:{},comparative:{},basisNote:$('taxBasisNote').value||''};
    $('taxInputRows').querySelectorAll('[data-tax-key]').forEach(input=>out[input.dataset.taxPeriod][input.dataset.taxKey]=input.value);
    return out;
  }
  function renderTaxInputs(saved){
    const data=saved||{};
    $('taxBasisNote').value=data.basisNote||'';
    $('taxInputRows').querySelectorAll('[data-tax-key]').forEach(input=>{
      const period=input.dataset.taxPeriod,key=input.dataset.taxKey;
      input.value=data[period]&&data[period][key]!=null?data[period][key]:'';
    });
  }
  function calculateTaxReconciliation(totals,period){
    const data=readTax()[period]||{},value=k=>num(data[k])||0,existingTax=totals.sums['pl.tax']||0;
    const profitBeforeTax=totals.income-(totals.expenses-existingTax);
    const taxableProfit=profitBeforeTax+value('nonDeductible')-value('nonTaxable')+value('otherAdjustments');
    const rate=data.taxRate===''?null:num(data.taxRate);
    const currentTax=data.currentTaxOverride!==''?(num(data.currentTaxOverride)||0):(rate===null?null:Math.max(0,taxableProfit*rate/100));
    const deferredTaxExpense=(value('closingDTL')-value('openingDTL'))-(value('closingDTA')-value('openingDTA'))-value('deferredOutsidePL');
    const totalTaxExpense=(currentTax===null?0:currentTax)+deferredTaxExpense;
    return {profitBeforeTax,taxableProfit,rate,currentTax,deferredTaxExpense,totalTaxExpense,existingTax,difference:totalTaxExpense-existingTax,complete:currentTax!==null};
  }
  function taxReconciliationTable(current,comparative,comparativeProvided){
    const c1=calculateTaxReconciliation(current,'current'),c2=calculateTaxReconciliation(comparative,'comparative');
    const rows=[
      ['Accounting profit / (loss) before tax',x=>x.profitBeforeTax],
      ['Add: non-deductible expenses',x=>x.nonDeductible],
      ['Less: non-taxable income',x=>-x.nonTaxable],
      ['Other tax adjustments',x=>x.otherAdjustments],
      ['Taxable profit / (loss)',x=>x.taxableProfit],
      ['Applicable tax rate',x=>x.rate===null?'Not entered':x.rate.toFixed(2)+'%'],
      ['Current tax expense',x=>x.currentTax===null?'Rate or override required':fmt(x.currentTax)],
      ['Deferred tax expense / (credit)',x=>fmt(x.deferredTaxExpense)],
      ['Total tax expense / (credit) per reconciliation',x=>fmt(x.totalTaxExpense)],
      ['Tax expense currently recorded in SOPL',x=>fmt(x.existingTax)],
      ['Difference to recorded SOPL tax expense',x=>fmt(x.difference)]
    ];
    const rowsHtml=rows.map(([label,fn],i)=>{
      const a=i===1?{...c1,nonDeductible:num(readTax().current.nonDeductible)||0}:i===2?{...c1,nonTaxable:num(readTax().current.nonTaxable)||0}:i===3?{...c1,otherAdjustments:num(readTax().current.otherAdjustments)||0}:c1;
      const b=i===1?{...c2,nonDeductible:num(readTax().comparative.nonDeductible)||0}:i===2?{...c2,nonTaxable:num(readTax().comparative.nonTaxable)||0}:i===3?{...c2,otherAdjustments:num(readTax().comparative.otherAdjustments)||0}:c2;
      return '<tr class="'+([4,8,10].includes(i)?'total':'')+'"><td>'+label+'</td><td>'+fn(a)+'</td>'+(comparativeProvided?'<td>'+fn(b)+'</td>':'')+'</tr>';
    }).join('');
    const country=escapeHtml($('country').value||'Not specified'),basis=escapeHtml(readTax().basisNote||'Not specified');
    const status=c1.complete?'Tax calculation completed for '+country+'. Confirm the tax basis ('+basis+'), deferred tax recognition and local-law adjustments.':'Enter a current-period tax rate or current tax override to calculate current tax. Deferred tax movement is shown separately.';
    $('taxStatus').innerHTML='<div class="fsg-statement-check '+(c1.complete?'ok':'warn')+'">'+status+'</div><div class="fsg-statement-check warn">The reconciliation is presented separately and does not automatically overwrite the tax expense mapped in the source trial balance or manual SOPL. Update the source tax line to the reconciled amount, where appropriate, before finalising the statements.</div>';
    return '<article class="fsg-statement-card"><h3>Income Tax Reconciliation</h3><p class="fsg-period-note">Tax jurisdiction: '+country+' · Tax basis / reference: '+basis+'</p><table><thead><tr><th>Particulars</th><th>Current period</th>'+(comparativeProvided?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+rowsHtml+'</tbody></table><p class="fsg-period-note">Deferred tax movement is based on opening and closing deferred tax asset / liability balances entered as tax-effect amounts, less deferred tax recognised directly in OCI or equity. A positive amount is an expense; a negative amount is a credit. Review IAS 12 (or the applicable local framework) and local tax legislation.</p></article>';
  }
  const CF_FIELDS=[
    ['openingCash','Opening cash and cash equivalents (auto from comparative SOFP; zero in first year)'],
    ['depreciation','Depreciation and amortisation added back (auto from SOPL)'],
    ['impairment','Impairment losses added back (auto from SOPL)'],
    ['provisionMovement','Increase / (decrease) in provisions (auto from SOFP)'],
    ['lossDisposal','Loss on disposal of non-current assets added back'],
    ['gainDisposal','Gain on disposal of non-current assets deducted'],
    ['receivablesChange','Change in trade and other receivables (auto from SOFP; signed)'],
    ['inventoryChange','Change in inventories (auto from SOFP; signed)'],
    ['otherOperatingAssetsChange','Change in other operating assets (auto from SOFP; signed)'],
    ['payablesChange','Change in trade and other payables (auto from SOFP; signed)'],
    ['otherOperatingLiabilitiesChange','Change in other operating liabilities (auto from SOFP; signed)'],
    ['taxPaid','Income taxes paid'],
    ['interestPaid','Interest paid'],
    ['interestReceived','Interest received'],
    ['dividendsReceived','Dividends received'],
    ['ppePurchases','Estimated PPE purchases (auto from SOFP movement; override for disposals / revaluation)'],
    ['ppeProceeds','Proceeds from disposal of property, plant and equipment'],
    ['intangiblePurchases','Purchases of intangible assets'],
    ['investmentPurchases','Estimated investment purchases (auto from SOFP movement)'],
    ['investmentProceeds','Proceeds from disposal of investments'],
    ['dividendsPaid','Dividends paid'],
    ['borrowingsProceeds','Estimated net increase in borrowings (auto from SOFP)'],
    ['borrowingsRepayments','Estimated net decrease in borrowings (auto from SOFP)'],
    ['leasePrincipal','Repayment of lease liabilities (principal)'],
    ['shareIssueProceeds','Proceeds from issue of shares'],
    ['ownerContributions','Owner / partner capital contributions'],
    ['ownerDrawings','Owner / partner drawings and distributions'],
    ['fxEffect','Effect of exchange-rate changes on cash']
  ];
  function renderCashFlowInputs(saved){
    const data=saved||{};
    $('cfInputRows').innerHTML=CF_FIELDS.map(([key,label])=>'<tr><th scope="row">'+escapeHtml(label)+'</th>'+['current','comparative'].map(period=>'<td><input type="number" step="0.01" data-cf-key="'+key+'" data-cf-period="'+period+'" aria-label="'+escapeHtml(label+' '+period)+'" value="'+escapeHtml((data[period]||{})[key]??'')+'" placeholder="0.00"></td>').join('')+'</tr>').join('');
    ['cfInterestPaidPolicy','cfInterestReceivedPolicy','cfDividendsReceivedPolicy'].forEach(id=>{if(data.policies&&data.policies[id])$(id).value=data.policies[id];});
  }
  function readCashFlow(){
    const data={current:{},comparative:{},policies:{}};
    $('cfInputRows').querySelectorAll('[data-cf-key]').forEach(input=>data[input.dataset.cfPeriod][input.dataset.cfKey]=input.value);
    ['cfInterestPaidPolicy','cfInterestReceivedPolicy','cfDividendsReceivedPolicy'].forEach(id=>data.policies[id]=$(id).value);
    return data;
  }

  function calculateCashFlow(period,totals,comparativeTotals,comparativeProvided){
    const data=readCashFlow(),prior=period==='current'?(comparativeProvided?comparativeTotals:null):null;
    const balance=(t,key)=>t&&t.sums?Number(t.sums[key]||0):0;
    const movement=(key)=>balance(totals,key)-balance(prior,key);
    const auto={openingCash:0,depreciation:0,impairment:0,provisionMovement:0,receivablesChange:0,inventoryChange:0,otherOperatingAssetsChange:0,payablesChange:0,otherOperatingLiabilitiesChange:0,ppePurchases:0,investmentPurchases:0,borrowingsProceeds:0,borrowingsRepayments:0,ownerContributions:0,shareIssueProceeds:0,ownerDrawings:0,dividendsPaid:0};
    if(period==='current'){
      auto.openingCash=comparativeProvided?balance(comparativeTotals,'asset.current.cash'):0;
      auto.depreciation=balance(totals,'pl.depreciation');
      auto.impairment=balance(totals,'pl.impairment');
      auto.provisionMovement=movement('liability.current.provisions')+movement('liability.noncurrent.provisions');
      auto.receivablesChange=-movement('asset.current.receivables');
      auto.inventoryChange=-movement('asset.current.inventory');
      auto.otherOperatingAssetsChange=-movement('asset.current.other');
      auto.payablesChange=movement('liability.current.payables');
      auto.otherOperatingLiabilitiesChange=movement('liability.current.other');
      const ppeMovement=movement('asset.noncurrent.ppe');
      auto.ppePurchases=Math.max(0,ppeMovement+auto.depreciation+auto.impairment);
      auto.investmentPurchases=Math.max(0,movement('asset.noncurrent.investment'));
      const borrowingsMovement=movement('liability.current.borrowings')+movement('liability.noncurrent.borrowings');
      auto.borrowingsProceeds=Math.max(0,borrowingsMovement);
      auto.borrowingsRepayments=Math.max(0,-borrowingsMovement);
      const equityRows=readSoce(),equityValues=Object.values(equityRows);
      auto.ownerContributions=$('entityType').value==='company'?0:equityValues.reduce((sum,row)=>sum+(num(row.contributions)||0),0);
      auto.shareIssueProceeds=$('entityType').value==='company'?equityValues.reduce((sum,row)=>sum+(num(row.contributions)||0),0):0;
      auto.ownerDrawings=$('entityType').value==='company'?0:equityValues.reduce((sum,row)=>sum+(num(row.distributions)||0),0);
      auto.dividendsPaid=$('entityType').value==='company'?equityValues.reduce((sum,row)=>sum+(num(row.distributions)||0),0):0;
    }
    const v=k=>data[period][k]!==''&&data[period][k]!=null?(num(data[period][k])||0):(auto[k]??0);
    const resolved={};CF_FIELDS.forEach(([key])=>resolved[key]=v(key));
    const operatingProfit=(totals.sums['pl.revenue']||0)+(totals.sums['pl.otherincome']||0)-(totals.sums['pl.costsales']||0)-(totals.sums['pl.employee']||0)-(totals.sums['pl.depreciation']||0)-(totals.sums['pl.impairment']||0)-(totals.sums['pl.otheroperating']||0);
    const adjustments={
      depreciation:v('depreciation'),impairment:v('impairment'),provisionMovement:v('provisionMovement'),
      lossDisposal:v('lossDisposal'),gainDisposal:-v('gainDisposal'),
      receivablesChange:v('receivablesChange'),inventoryChange:v('inventoryChange'),
      otherOperatingAssetsChange:v('otherOperatingAssetsChange'),payablesChange:v('payablesChange'),
      otherOperatingLiabilitiesChange:v('otherOperatingLiabilitiesChange')
    };
    const working=Object.values(adjustments).reduce((a,b)=>a+b,0);
    const tax=-v('taxPaid'),interestPaid=-v('interestPaid'),interestReceived=v('interestReceived'),dividendsReceived=v('dividendsReceived');
    const policies=data.policies;
    const operatingInterestPaid=policies.cfInterestPaidPolicy==='operating'?interestPaid:0;
    const financingInterestPaid=policies.cfInterestPaidPolicy==='financing'?interestPaid:0;
    const operatingInterestReceived=policies.cfInterestReceivedPolicy==='operating'?interestReceived:0;
    const investingInterestReceived=policies.cfInterestReceivedPolicy==='investing'?interestReceived:0;
    const operatingDividendsReceived=policies.cfDividendsReceivedPolicy==='operating'?dividendsReceived:0;
    const investingDividendsReceived=policies.cfDividendsReceivedPolicy==='investing'?dividendsReceived:0;
    const cashGenerated=operatingProfit+working;
    const operating=cashGenerated+tax+operatingInterestPaid+operatingInterestReceived+operatingDividendsReceived;
    const investing=-v('ppePurchases')+v('ppeProceeds')-v('intangiblePurchases')-v('investmentPurchases')+v('investmentProceeds')+investingInterestReceived+investingDividendsReceived;
    const financing=financingInterestPaid-v('dividendsPaid')+v('borrowingsProceeds')-v('borrowingsRepayments')-v('leasePrincipal')+v('shareIssueProceeds')+v('ownerContributions')-v('ownerDrawings');
    const net=operating+investing+financing,fx=v('fxEffect'),opening=v('openingCash'),closing=opening+net+fx;
    const sofpCash=totals.sums['asset.current.cash']||0;
    return {operatingProfit,adjustments,working,cashGenerated,tax,operatingInterestPaid,financingInterestPaid,operatingInterestReceived,investingInterestReceived,operatingDividendsReceived,investingDividendsReceived,operating,investing,financing,net,fx,opening,closing,sofpCash,difference:closing-sofpCash,hasInputs:Object.values(data[period]).some(x=>x!==''),auto,values:resolved};
  }
  function cashFlowTable(current,comparative,comparativeProvided){
    const c1=calculateCashFlow('current',current,comparative,comparativeProvided),c2=calculateCashFlow('comparative',comparative,null,false);
    const lines=[
      ['Operating profit',x=>x.operatingProfit],
      ['Depreciation and amortisation',x=>x.adjustments.depreciation],
      ['Impairment losses',x=>x.adjustments.impairment],
      ['Increase / (decrease) in provisions',x=>x.adjustments.provisionMovement],
      ['Loss on disposal of non-current assets',x=>x.adjustments.lossDisposal],
      ['Gain on disposal of non-current assets',x=>x.adjustments.gainDisposal],
      ['Change in trade and other receivables',x=>x.adjustments.receivablesChange],
      ['Change in inventories',x=>x.adjustments.inventoryChange],
      ['Change in other operating assets',x=>x.adjustments.otherOperatingAssetsChange],
      ['Change in trade and other payables',x=>x.adjustments.payablesChange],
      ['Change in other operating liabilities',x=>x.adjustments.otherOperatingLiabilitiesChange],
      ['Cash generated from operations',x=>x.cashGenerated],
      ['Income taxes paid',x=>x.tax],
      ['Interest paid (operating classification)',x=>x.operatingInterestPaid],
      ['Interest received (operating classification)',x=>x.operatingInterestReceived],
      ['Dividends received (operating classification)',x=>x.operatingDividendsReceived],
      ['Net cash from / (used in) operating activities',x=>x.operating],
      ['Purchases of property, plant and equipment',x=>-x.values.ppePurchases],
      ['Proceeds from disposal of property, plant and equipment',x=>x.values.ppeProceeds],
      ['Purchases of intangible assets',x=>-x.values.intangiblePurchases],
      ['Purchases of investments',x=>-x.values.investmentPurchases],
      ['Proceeds from disposal of investments',x=>x.values.investmentProceeds],
      ['Interest received (investing classification)',x=>x.investingInterestReceived],
      ['Dividends received (investing classification)',x=>x.investingDividendsReceived],
      ['Net cash from / (used in) investing activities',x=>x.investing],
      ['Interest paid (financing classification)',x=>x.financingInterestPaid],
      ['Proceeds from borrowings',x=>x.values.borrowingsProceeds],
      ['Repayment of borrowings',x=>-x.values.borrowingsRepayments],
      ['Repayment of lease liabilities',x=>-x.values.leasePrincipal],
      ['Proceeds from issue of shares',x=>x.values.shareIssueProceeds],
      ['Owner / partner capital contributions',x=>x.values.ownerContributions],
      ['Dividends / owner distributions paid',x=>-x.values.dividendsPaid-x.values.ownerDrawings],
      ['Net cash from / (used in) financing activities',x=>x.financing],
      ['Net increase / (decrease) before exchange differences',x=>x.net],
      ['Effect of exchange-rate changes',x=>x.fx],
      ['Cash and cash equivalents at beginning of period',x=>x.opening],
      ['Cash and cash equivalents at end of period',x=>x.closing]
    ];
    const cfData=readCashFlow();
    const value=(x,idx,line)=> {
      if(idx===0)return line[1](c1);
      const key=line[0];
      if(key==='Purchases of property, plant and equipment')return -c2.values.ppePurchases;
      if(key==='Proceeds from disposal of property, plant and equipment')return c2.values.ppeProceeds;
      if(key==='Purchases of intangible assets')return -c2.values.intangiblePurchases;
      if(key==='Purchases of investments')return -c2.values.investmentPurchases;
      if(key==='Proceeds from disposal of investments')return c2.values.investmentProceeds;
      if(key==='Proceeds from borrowings')return c2.values.borrowingsProceeds;
      if(key==='Repayment of borrowings')return -c2.values.borrowingsRepayments;
      if(key==='Repayment of lease liabilities')return -c2.values.leasePrincipal;
      if(key==='Proceeds from issue of shares')return c2.values.shareIssueProceeds;
      if(key==='Owner / partner capital contributions')return c2.values.ownerContributions;
      if(key==='Dividends / owner distributions paid')return -c2.values.dividendsPaid-c2.values.ownerDrawings;
      return line[1](c2);
    };
    const rows=lines.map((line,i)=>'<tr class="'+(['Cash generated from operations','Net cash from / (used in) operating activities','Net cash from / (used in) investing activities','Net cash from / (used in) financing activities','Net increase / (decrease) before exchange differences','Cash and cash equivalents at end of period'].includes(line[0])?'total':'')+'"><td>'+line[0]+'</td><td>'+fmt(value(c1,0,line))+'</td>'+(comparativeProvided?'<td>'+fmt(value(c2,1,line))+'</td>':'')+'</tr>').join('');
    const htmlOut='<article class="fsg-statement-card"><h3>Statement of Cash Flows</h3><table><thead><tr><th>Particulars</th><th>Current period</th>'+(comparativeProvided?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table><p class="fsg-period-note">Prepared using the indirect method. Opening cash, non-cash expenses and working-capital movements are derived from available statements where possible. Blank supplementary inputs use estimates; enter an amount to override. Confirm non-cash transactions, disposals and gross cash movements before use.</p></article>';
    const status=[];
    [['Current',c1],['Comparative',c2]].forEach(([name,x])=>{
      if(name==='Comparative'&&!comparativeProvided)return;
      status.push('<div class="fsg-statement-check '+(Math.abs(x.difference)<0.005?'ok':'warn')+'">'+name+' cash-flow closing balance: '+fmt(x.closing)+'; SOFP cash: '+fmt(x.sofpCash)+'; difference: '+fmt(x.difference)+(Math.abs(x.difference)<0.005?' — reconciles.':' — does not reconcile. Check opening cash and supplementary movements.')+'</div>');
      if(name==='Current')status.push('<div class="fsg-statement-check">Automatically derived from SOPL / SOFP where possible. Blank input fields use calculated defaults; entered amounts override those defaults. Confirm PPE acquisitions, disposals, borrowing proceeds / repayments and actual tax paid.</div>');
    });
    $('cashFlowStatus').innerHTML=status.join('');
    return htmlOut;
  }
  const SOCE_COMPONENTS=()=>{
    const type=$('entityType').value;
    if(type==='sole-trader')return ["Owner's capital","Retained earnings","Other reserves"];
    if(type==='partnership')return ["Partners' capital","Retained earnings","Other reserves"];
    return ['Share capital','Share premium','Retained earnings','Other reserves'];
  };
  function renderSoceInputs(saved){
    const prior=saved||{};
    $('soceInputRows').innerHTML=SOCE_COMPONENTS().map(name=>{
      const row=prior[name]||{},fields=['opening','contributions','profit','oci','distributions','transfers','other'];
      return '<tr data-soce-component="'+escapeHtml(name)+'"><th scope="row">'+escapeHtml(name)+'</th>'+
        fields.map(f=>'<td><input type="number" step="0.01" data-soce-field="'+f+'" aria-label="'+escapeHtml(name+' '+f)+'" value="'+escapeHtml(row[f]??'')+'" placeholder="0.00"></td>').join('')+
        '<td class="soce-closing" data-soce-closing>0.00</td></tr>';
    }).join('');
    updateSoceClosings();
  }
  function readSoce(){
    const out={};
    $('soceInputRows').querySelectorAll('tr[data-soce-component]').forEach(tr=>{
      const row={};tr.querySelectorAll('[data-soce-field]').forEach(input=>row[input.dataset.soceField]=input.value);
      out[tr.dataset.soceComponent]=row;
    });
    return out;
  }
  function soceAmount(row){
    const v=k=>num(row[k])||0;
    return v('opening')+v('contributions')+v('profit')+v('oci')-v('distributions')+v('transfers')+v('other');
  }
  function updateSoceClosings(){
    if(!$('soceInputRows'))return;
    $('soceInputRows').querySelectorAll('tr[data-soce-component]').forEach(tr=>{
      const row={};tr.querySelectorAll('[data-soce-field]').forEach(input=>row[input.dataset.soceField]=input.value);
      tr.querySelector('[data-soce-closing]').textContent=fmt(soceAmount(row));
    });
  }
  function soceOutput(current,comparative,comparativeProvided){
    const rows=readSoce(),names=Object.keys(rows),total=names.reduce((s,n)=>s+soceAmount(rows[n]),0);
    const difference=total-current.equity;
    const detail=names.map(name=>'<tr><td>'+escapeHtml(name)+'</td><td>'+fmt(num(rows[name].opening)||0)+'</td><td>'+fmt(num(rows[name].contributions)||0)+'</td><td>'+fmt(num(rows[name].profit)||0)+'</td><td>'+fmt(num(rows[name].oci)||0)+'</td><td>('+fmt(num(rows[name].distributions)||0)+')</td><td>'+fmt(num(rows[name].transfers)||0)+'</td><td>'+fmt(num(rows[name].other)||0)+'</td><td><strong>'+fmt(soceAmount(rows[name]))+'</strong></td></tr>').join('');
    const hasInputs=names.some(n=>Object.values(rows[n]).some(v=>v!==''));
    const status=hasInputs?(Math.abs(difference)<.005?'ok':'warn'):'warn';
    $('soceStatus').innerHTML=hasInputs?'<div class="fsg-statement-check '+status+'">Total closing equity per SOCE: '+fmt(total)+'. SOFP equity: '+fmt(current.equity)+'. Difference: '+fmt(difference)+(Math.abs(difference)<.005?' — reconciles.':' — does not reconcile; investigate opening balances and movements.')+'</div>' : '<div class="fsg-statement-check warn">No equity movements entered. SOCE is not yet prepared.</div>';
    if(comparativeProvided)$('soceStatus').innerHTML+='<div class="fsg-statement-check warn">Comparative SOCE movements have not been entered in this release; comparative SOFP figures remain separate.</div>';
    return '<article class="fsg-statement-card"><h3>Statement of Changes in Equity</h3><div class="fsg-soce-table-wrap"><table class="fsg-soce-table"><thead><tr><th>Equity component</th><th>Opening</th><th>Contributions / issues</th><th>Profit allocated</th><th>OCI</th><th>Distributions / drawings</th><th>Transfers</th><th>Other adjustments</th><th>Closing</th></tr></thead><tbody>'+detail+'</tbody><tfoot><tr class="total"><th>Total equity</th>'+['opening','contributions','profit','oci','distributions','transfers','other'].map(k=>'<td>'+fmt(names.reduce((s,n)=>s+(num(rows[n][k])||0),0))+'</td>').join('')+'<td>'+fmt(total)+'</td></tr></tfoot></table></div><p class="fsg-period-note">Reconciliation difference against calculated SOFP equity: '+fmt(difference)+'. A reconciliation is a mathematical check, not evidence of IFRS compliance.</p></article>';
  }

  const IFRS18_CHECKLIST=[
    'Income and expenses classified into operating, investing, financing, income taxes and discontinued operations',
    'Operating profit and profit before financing and income taxes presented',
    'Main business activity assessed (investing in assets / providing finance to customers)',
    'Expenses presented by nature or by function; by-nature amounts disclosed if function is used',
    'Aggregation and disaggregation reviewed; no material other balances left unexplained',
    'Management-defined performance measures identified and reconciled in a single note',
    'Cash flow statement starts from operating profit; interest and dividends classified per amended IAS 7',
    'Comparative information restated on the IFRS 18 basis, where required',
    'Transition disclosures prepared, including comparative profit or loss reconciliation where required',
    'Accounting policies updated for IFRS 18 and consequential amendments',
    'Specified main business activities assessed for entity-specific category classification',
    'Material judgements and estimation uncertainty disclosures reviewed'
  ];
  const EXCEL_NUM_FMT='#,##0.00;[Red](#,##0.00);-';
  function excelSheet(wb,name,title,subtitle,headers,rows){
    const ws=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:4}]});
    const count=Math.max(headers.length,1);
    ws.mergeCells(1,1,1,count);ws.getCell(1,1).value=title;
    ws.mergeCells(2,1,2,count);ws.getCell(2,1).value=subtitle||'';
    ws.getRow(4).values=headers;
    rows.forEach(row=>ws.addRow(row));
    ws.getRow(1).height=28;ws.getRow(2).height=32;ws.getRow(4).height=25;
    ws.getRow(1).font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF182A3A'}};
    ws.getRow(2).font={name:'Aptos',size:10,italic:true,color:{argb:'FF526171'}};
    ws.getRow(2).alignment={vertical:'middle',wrapText:true};
    ws.getRow(4).font={name:'Aptos',size:10,bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFB3132B'}};
    ws.getRow(4).alignment={vertical:'middle',wrapText:true};
    ws.eachRow((row,rowNumber)=>{
      row.eachCell({includeEmpty:true},cell=>{
        if(rowNumber>4){
          cell.font={name:'Aptos',size:10,color:{argb:'FF263445'}};
          cell.alignment={vertical:'top',wrapText:true};
          if(rowNumber%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF5F7FA'}};
          if(typeof cell.value==='number')cell.numFmt=EXCEL_NUM_FMT;
        }
        cell.border={bottom:{style:'hair',color:{argb:'FFE0E5EB'}}};
      });
    });
    ws.columns=headers.map((h,i)=>({width:Math.max(14,Math.min(i===0?38:24,String(h).length+5))}));
    ws.getColumn(1).width=Math.max(26,Math.min(48,ws.getColumn(1).width||30));
    if(rows.length)ws.autoFilter={from:{row:4,column:1},to:{row:4,column:headers.length}};
    ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:4'};
    ws.properties.defaultRowHeight=18;
    return ws;
  }
  function workbookStatementRows(rows){
    return rows.map(r=>[r.label,r.current,r.comparative]);
  }
  function workbookCashFlowRows(current,comparative,comparativeProvided){
    const c1=calculateCashFlow('current',current,comparative,comparativeProvided),c2=calculateCashFlow('comparative',comparative,null,false);
    const lines=[
      ['Operating profit',x=>x.operatingProfit],
      ['Depreciation and amortisation',x=>x.adjustments.depreciation],
      ['Impairment losses',x=>x.adjustments.impairment],
      ['Increase / (decrease) in provisions',x=>x.adjustments.provisionMovement],
      ['Loss on disposal of non-current assets',x=>x.adjustments.lossDisposal],
      ['Gain on disposal of non-current assets',x=>x.adjustments.gainDisposal],
      ['Change in trade and other receivables',x=>x.adjustments.receivablesChange],
      ['Change in inventories',x=>x.adjustments.inventoryChange],
      ['Change in other operating assets',x=>x.adjustments.otherOperatingAssetsChange],
      ['Change in trade and other payables',x=>x.adjustments.payablesChange],
      ['Change in other operating liabilities',x=>x.adjustments.otherOperatingLiabilitiesChange],
      ['Cash generated from operations',x=>x.cashGenerated],
      ['Income taxes paid',x=>x.tax],
      ['Interest paid (operating classification)',x=>x.operatingInterestPaid],
      ['Interest received (operating classification)',x=>x.operatingInterestReceived],
      ['Dividends received (operating classification)',x=>x.operatingDividendsReceived],
      ['Net cash from / (used in) operating activities',x=>x.operating],
      ['Purchases of property, plant and equipment',x=>-x.values.ppePurchases],
      ['Proceeds from disposal of property, plant and equipment',x=>x.values.ppeProceeds],
      ['Purchases of intangible assets',x=>-x.values.intangiblePurchases],
      ['Purchases of investments',x=>-x.values.investmentPurchases],
      ['Proceeds from disposal of investments',x=>x.values.investmentProceeds],
      ['Interest received (investing classification)',x=>x.investingInterestReceived],
      ['Dividends received (investing classification)',x=>x.investingDividendsReceived],
      ['Net cash from / (used in) investing activities',x=>x.investing],
      ['Interest paid (financing classification)',x=>x.financingInterestPaid],
      ['Proceeds from borrowings',x=>x.values.borrowingsProceeds],
      ['Repayment of borrowings',x=>-x.values.borrowingsRepayments],
      ['Repayment of lease liabilities',x=>-x.values.leasePrincipal],
      ['Proceeds from issue of shares',x=>x.values.shareIssueProceeds],
      ['Owner / partner capital contributions',x=>x.values.ownerContributions],
      ['Dividends / owner distributions paid',x=>-x.values.dividendsPaid-x.values.ownerDrawings],
      ['Net cash from / (used in) financing activities',x=>x.financing],
      ['Net increase / (decrease) before exchange differences',x=>x.net],
      ['Effect of exchange-rate changes',x=>x.fx],
      ['Cash and cash equivalents at beginning of period',x=>x.opening],
      ['Cash and cash equivalents at end of period',x=>x.closing]
    ];
    return {rows:lines.map(([label,fn])=>[label,fn(c1),comparativeProvided?fn(c2):null]),current:c1,comparative:c2};
  }
  function workbookTaxRows(current,comparative,comparativeProvided){
    const a=calculateTaxReconciliation(current,'current'),b=calculateTaxReconciliation(comparative,'comparative');
    const tax=readTax();
    const rows=[
      ['Accounting profit / (loss) before tax',a.profitBeforeTax,b.profitBeforeTax],
      ['Add: non-deductible expenses',num(tax.current.nonDeductible)||0,num(tax.comparative.nonDeductible)||0],
      ['Less: non-taxable income',-(num(tax.current.nonTaxable)||0),-(num(tax.comparative.nonTaxable)||0)],
      ['Other tax adjustments',num(tax.current.otherAdjustments)||0,num(tax.comparative.otherAdjustments)||0],
      ['Taxable profit / (loss)',a.taxableProfit,b.taxableProfit],
      ['Applicable income tax rate',a.rate===null?'Not entered':a.rate/100, b.rate===null?'Not entered':b.rate/100],
      ['Current tax expense',a.currentTax,b.currentTax],
      ['Deferred tax expense / (credit)',a.deferredTaxExpense,b.deferredTaxExpense],
      ['Total tax expense / (credit) per reconciliation',a.totalTaxExpense,b.totalTaxExpense],
      ['Tax expense recorded in SOPL',a.existingTax,b.existingTax],
      ['Difference to recorded SOPL tax expense',a.difference,b.difference]
    ];
    return {rows:rows.map(r=>comparativeProvided?r:[r[0],r[1]]),current:a,comparative:b};
  }
  function exportExcelWorkbook(){
    if(!lastGeneratedReport||$('statementOutput').hidden){$('exportStatus').textContent='Generate the financial statements before exporting.';return;}
    if(!window.ExcelJS){$('exportStatus').textContent='The Excel workbook library could not load. Refresh the page and try again.';return;}
    const btn=$('exportExcelBtn');btn.disabled=true;$('exportStatus').textContent='Preparing your Excel workbook…';
    try{
      const wb=new ExcelJS.Workbook();wb.creator='BikasB Financial Statement Generator';wb.subject='Financial statements and supporting working papers';wb.title='Financial Statements — '+($('entityName').value||'Entity');wb.company='BikasB';wb.created=new Date();wb.modified=new Date();wb.calcProperties.fullCalcOnLoad=true;
      const entity=$('entityName').value||'Entity not specified',currency=$('currency').value||'',period=$('periodStart').value&&$('periodEnd').value?$('periodStart').value+' to '+$('periodEnd').value:($('periodEnd').value||'Current reporting period'),compPeriod=$('comparativeStart').value&&$('comparativeEnd').value?$('comparativeStart').value+' to '+$('comparativeEnd').value:($('comparativeEnd').value||'Comparative period not provided');
      const current=lastGeneratedReport.current,comparative=lastGeneratedReport.comparative,hasComp=lastGeneratedReport.comparativeProvided;
      const coverRows=[
        ['Entity name',entity],['Entity type',$('entityType').selectedOptions[0].textContent],['Country / tax jurisdiction',$('country').value||'Not specified'],
        ['Presentation currency',currency],['Current reporting period',period],['Comparative reporting period',hasComp?compPeriod:'Not provided'],
        ['Reporting framework',$('framework').value==='ifrs18'?'IFRS 18':'IAS 1'],['IFRS 18 early adoption',$('earlyAdoption')?$('earlyAdoption').value:'Not specified'],
        ['Main business activity',$('mainBusinessActivity').value||'Not assessed'],['Trial balance basis',state.mode==='trial-balance'?$('tbBasis').value:'Not applicable'],
        ['Preparation route',state.mode==='trial-balance'?'Imported trial balance':'Manual entry'],
        ['Source file',state.fileName||'Manual entry'],['Generated at',new Date().toLocaleString()],
        ['Workbook basis','Statement and reconciliation sheets are a snapshot of the generator output at export time. Editing source data in Excel does not rerun the browser calculation engine.'],
        ['Important','Review every mapping, estimate, judgement, disclosure and check. A mathematically balanced workbook is not evidence of IFRS or statutory compliance.']
      ];
      excelSheet(wb,'Cover','FINANCIAL STATEMENTS WORKBOOK',entity+' · '+period,['Field','Details'],coverRows);
      const tbRows=[];
      if(state.mode==='trial-balance'){
        (state.imported||[]).forEach(item=>{
          const mapItem=(state.mappingItems||[]).find(x=>x.id===(item.mappingId||('tb:'+item.row+':'+(item.code||'')+':'+item.name.trim().toLowerCase())));
          const key=mapItem?mappedKey(mapItem):'unresolved',saved=state.mappings[mapItem&&mapItem.id||'']||{};
          tbRows.push([item.code||'',item.name,'Trial balance',item.debit,item.credit,item.comparativeDebit,item.comparativeCredit,key,saved.category||suggestedIfrs18Category(key),!!saved.approved?'Approved':'Not approved',item.row||'']);
        });
      }else{
        (state.mappingItems||[]).forEach(item=>{
          const key=mappedKey(item),saved=state.mappings[item.id]||{};
          tbRows.push([item.code||'',item.name,item.sourceType==='field'?'Manual balance input':item.sourceType==='income'?'Manual income input':'Manual expense input',item.sourceType==='tb'?item.debit||0:null,item.sourceType==='tb'?item.credit||0:null,item.amount,item.comparativeAmount,key,saved.category||suggestedIfrs18Category(key),saved.approved?'Approved':'Not approved',item.fieldId||'']);
        });
        ['mOpeningCapital','mCapitalIntroduced','mDrawings','mCapitalAdjustments','mOpeningPartnerCapital','mPartnerContributions','mPartnerDrawings','mPartnerAdjustments','mOpeningEquity','mShareIssues','mDividends','mOtherEquity','mCompClosingEquity'].forEach(id=>{
          const el=$(id);if(el&&el.value!=='')tbRows.push(['',el.parentElement.textContent.trim(),'Manual equity input',null,null,num(el.value),null,'equity.movement','Not applicable','User input',id]);
        });
      }
      excelSheet(wb,'TB','SOURCE DATA AND ACCOUNT MAPPING','Input route: '+(state.mode==='trial-balance'?'Trial balance':'Manual entry')+' · Amounts and classifications shown as captured at export time.',['Code / field','Account or input description','Source type','Current debit','Current credit','Current amount / comparative debit','Comparative credit','Approved statement mapping','IFRS 18 category','Mapping approval','Source row / field'],tbRows);
      const cf=readCashFlow(),cfInputRows=CF_FIELDS.map(([key,label])=>[label,cf.current[key]===''?null:num(cf.current[key]),cf.comparative[key]===''?null:num(cf.comparative[key]),key]);
      excelSheet(wb,'CF Inputs','CASH FLOW INPUTS','Blank values may use calculated defaults in the generator. Values here are the user-entered overrides, not necessarily the final cash-flow amount.',['Input','Current period override','Comparative period override','Internal key'],cfInputRows);
      const cfPolicies=[['Interest paid classification',cf.policies.cfInterestPaidPolicy],['Interest received classification',cf.policies.cfInterestReceivedPolicy],['Dividends received classification',cf.policies.cfDividendsReceivedPolicy]];
      cfPolicies.forEach(row=>cfInputRows.push(row));
      const cfData=workbookCashFlowRows(current,comparative,hasComp);
      excelSheet(wb,'SOFP','STATEMENT OF FINANCIAL POSITION','As at reporting date · '+currency,['Particulars','Current period','Comparative period'],workbookStatementRows(lastGeneratedReport.currentRows));
      excelSheet(wb,'SOPL','STATEMENT OF PROFIT OR LOSS','For the reporting period · '+currency,['Particulars','Current period','Comparative period'],workbookStatementRows(lastGeneratedReport.plRows));
      excelSheet(wb,'SOCI','STATEMENT OF COMPREHENSIVE INCOME','For the reporting period · '+currency,['Particulars','Current period','Comparative period'],workbookStatementRows(lastGeneratedReport.ociRows));
      const soce=readSoce(),soceRows=Object.entries(soce).map(([name,row])=>[name,num(row.opening)||0,num(row.contributions)||0,num(row.profit)||0,num(row.oci)||0,-(num(row.distributions)||0),num(row.transfers)||0,num(row.other)||0,soceAmount(row),null]);
      soceRows.push(['TOTAL',...['opening','contributions','profit','oci','distributions','transfers','other'].map(k=>Object.values(soce).reduce((s,row)=>s+(num(row[k])||0),0)),Object.values(soce).reduce((s,row)=>s+soceAmount(row),0),null]);
      excelSheet(wb,'SOCE','STATEMENT OF CHANGES IN EQUITY','Current-period movement schedule. Comparative SOCE movements are not yet captured by the generator.',['Equity component','Opening','Contributions / issues','Profit allocated','OCI','Distributions / drawings (deducted)','Transfers','Other adjustments','Closing','Comparative closing'],soceRows);
      excelSheet(wb,'SOCF','STATEMENT OF CASH FLOWS','Indirect method · starting from operating profit · '+currency,['Particulars','Current period','Comparative period'],cfData.rows);
      const tax=workbookTaxRows(current,comparative,hasComp);
      const noteData=readNotes(),noteLabels={
        principalActivities:'Principal activities and nature of operations',basisPreparation:'Basis of preparation and statement of compliance',goingConcern:'Going concern assessment',currencyPolicy:'Functional and presentation currency',
        policyRevenue:'Revenue recognition policy',policyPpe:'Property, plant and equipment policy',policyInventory:'Inventory policy',policyLeases:'Leases policy',policyFinancialInstruments:'Financial instruments and impairment policy',policyProvisions:'Provisions and contingencies policy',policyEmployeeBenefits:'Employee benefits policy',policyTax:'Income tax policy',
        judgements:'Significant management judgements',estimationUncertainty:'Key sources of estimation uncertainty',provisionDetails:'Nature, timing and uncertainties of provisions',revenueDisaggregation:'Revenue disaggregation',inventoryDetails:'Inventory write-downs and restrictions',receivablesDetails:'Receivables, credit risk and impairment',borrowingsDetails:'Borrowings, liquidity and security',leaseDetails:'Lease commitments and arrangements',relatedParties:'Related-party relationships and transactions',commitmentsContingencies:'Commitments and contingent liabilities / assets',subsequentEvents:'Events after the reporting period',capitalManagement:'Capital management and restrictions',dividends:'Dividends / distributions'
      };
      const noteRows=Object.keys(noteLabels).map(k=>[noteLabels[k],noteData.text[k]||'Not provided — assess applicability']);
      noteRows.push(['Tax jurisdiction / basis reference',$('country').value+' · '+(taxDataBasis())]);
      noteRows.push(['PPE movement schedule','Current period','Comparative period']);
      NOTE_SCHEDULES.ppe.forEach(k=>noteRows.push(['PPE · '+k,noteData.schedules.ppe.current[k]===''?null:num(noteData.schedules.ppe.current[k]),hasComp?(noteData.schedules.ppe.comparative[k]===''?null:num(noteData.schedules.ppe.comparative[k])):null]));
      noteRows.push(['Provisions movement schedule','Current period','Comparative period']);
      NOTE_SCHEDULES.provisions.forEach(k=>noteRows.push(['Provisions · '+k,noteData.schedules.provisions.current[k]===''?null:num(noteData.schedules.provisions.current[k]),hasComp?(noteData.schedules.provisions.comparative[k]===''?null:num(noteData.schedules.provisions.comparative[k])):null]));
      noteRows.push(['Tax reconciliation','Current period','Comparative period']);
      tax.rows.forEach(r=>noteRows.push(r));
      excelSheet(wb,'Notes','NOTES TO THE FINANCIAL STATEMENTS','Narrative inputs are user-prepared. Linked statement figures and movement schedules are shown in this workbook.',['Disclosure / schedule','Current period / narrative','Comparative period'],noteRows);
      const checks=[];
      const tbCurrent=state.mode==='trial-balance'?state.imported.reduce((s,r)=>s+r.debit-r.credit,0):null;
      const tbComparative=state.mode==='trial-balance'?state.imported.reduce((s,r)=>s+r.comparativeDebit-r.comparativeCredit,0):null;
      checks.push(['Source trial balance totals to nil',state.mode==='trial-balance'?tbCurrent:'Not applicable (manual input)',state.mode==='trial-balance'?(Math.abs(tbCurrent)<0.005?'OK':'REVIEW'):'Manual route']);
      if(state.mode==='trial-balance'&&hasComp)checks.push(['Comparative trial balance totals to nil',tbComparative,Math.abs(tbComparative)<0.005?'OK':'REVIEW']);
      const pending=(state.mappingItems||[]).filter(item=>!(state.mappings[item.id]||{}).approved||mappedKey(item)==='unresolved').length;
      checks.push(['All source mappings approved',pending===0?'All approved':pending+' pending',pending===0?'OK':'REVIEW']);
      checks.push(['Current statement of financial position balances',lastGeneratedReport.cDiff,Math.abs(lastGeneratedReport.cDiff)<0.005?'OK':'REVIEW']);
      if(hasComp)checks.push(['Comparative statement of financial position balances',lastGeneratedReport.pDiff,Math.abs(lastGeneratedReport.pDiff)<0.005?'OK':'REVIEW']);
      checks.push(['Current cash flow closing cash agrees to SOFP',cfData.current.difference,Math.abs(cfData.current.difference)<0.005?'OK':'REVIEW']);
      if(hasComp)checks.push(['Comparative cash flow closing cash agrees to SOFP',cfData.comparative.difference,Math.abs(cfData.comparative.difference)<0.005?'OK':'REVIEW']);
      const soceTotal=Object.values(soce).reduce((s,row)=>s+soceAmount(row),0),soceDiff=soceTotal-current.equity,soceHas=Object.values(soce).some(row=>Object.values(row).some(v=>v!==''));
      checks.push(['Current SOCE closing equity agrees to SOFP',soceHas?soceDiff:'No SOCE movements entered',soceHas?(Math.abs(soceDiff)<0.005?'OK':'REVIEW'):'REVIEW']);
      if(hasComp)checks.push(['Comparative SOCE movements','Not captured in this release','REVIEW']);
      checks.push(['Current tax reconciliation agrees to SOPL',tax.current.difference, tax.current.complete&&Math.abs(tax.current.difference)<0.005?'OK':'REVIEW']);
      const blankNotes=NOTE_TEXT_KEYS.filter(k=>!String(noteData.text[k]||'').trim()).length;
      checks.push(['Narrative disclosure fields completed',(NOTE_TEXT_KEYS.length-blankNotes)+' of '+NOTE_TEXT_KEYS.length,blankNotes===0?'REVIEW REQUIRED — applicability review still needed':'REVIEW']);
      const ppe=noteData.schedules.ppe.current,provs=noteData.schedules.provisions.current;
      const ppeAny=NOTE_SCHEDULES.ppe.some(k=>ppe[k]!==''),provAny=NOTE_SCHEDULES.provisions.some(k=>provs[k]!=='');
      if(ppeAny&&ppe.closing!=='')checks.push(['PPE note closing balance agrees to SOFP',num(ppe.closing)- (current.sums['asset.noncurrent.ppe']||0),Math.abs(num(ppe.closing)-(current.sums['asset.noncurrent.ppe']||0))<0.005?'OK':'REVIEW']);
      if(provAny&&provs.closing!=='')checks.push(['Provisions note closing balance agrees to SOFP',num(provs.closing)-(current.sums['liability.current.provisions']+current.sums['liability.noncurrent.provisions']),Math.abs(num(provs.closing)-(current.sums['liability.current.provisions']+current.sums['liability.noncurrent.provisions']))<0.005?'OK':'REVIEW']);
      checks.push(['IFRS / local statutory disclosure completeness','Requires professional assessment','NOT AUTOMATED']);
      excelSheet(wb,'Checks','VALIDATION AND RECONCILIATION CHECKS','OK means the stated arithmetic check passed. REVIEW / NOT AUTOMATED requires investigation or professional assessment.',['Check','Result / difference','Status'],checks);
      const checklistRows=IFRS18_CHECKLIST.map((item,i)=>[i+1,item,'To assess','']);
      excelSheet(wb,'IFRS Checklist','IFRS 18 PRESENTATION AND DISCLOSURE CHECKLIST','User completion required. The checklist is a review aid, not an assurance or compliance opinion.',['#','Requirement','Status','Reviewer comments'],checklistRows);
      const listRows=[];
      Object.entries(STATEMENT_GROUPS).forEach(([group,items])=>items.forEach(([key,label])=>listRows.push([key,label,group,$('framework').value==='ifrs18'?suggestedIfrs18Category(key):'Not applicable'])));
      excelSheet(wb,'Lists','MAPPING REFERENCE','Statement line mapping keys used by the generator.',['Mapping key','Statement line','Statement group','Suggested IFRS 18 category'],listRows);
      const safeName=(entity||'Entity').replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'')||'Entity';
      const dateTag=$('periodEnd').value||new Date().toISOString().slice(0,10);
      wb.xlsx.writeBuffer().then(buffer=>{
        const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='Financial_Statements_'+safeName+'_'+dateTag+'.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
        $('exportStatus').textContent='Excel workbook downloaded. Review the Checks and IFRS Checklist worksheets before issue.';
      }).catch(error=>{$('exportStatus').textContent='Workbook export failed: '+(error&&error.message?error.message:'Unknown error');})
        .finally(()=>{btn.disabled=false;});
    }catch(error){$('exportStatus').textContent='Workbook export failed: '+(error&&error.message?error.message:'Unknown error');btn.disabled=false;}
  }
  function taxDataBasis(){return readTax().basisNote||'Not specified';}

  function collectDraft(){return {version:6,soce:readSoce(),cashFlow:readCashFlow(),tax:readTax(),notes:readNotes(),savedAt:new Date().toISOString(),mode:state.mode,fields:readFields(),income:readRows('incomeRows'),expenses:readRows('expenseRows'),fileName:state.fileName,imported:state.imported||null,mappings:state.mappings};}
  function saveDraft(silent){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify(collectDraft()));$('saveState').textContent='Saved on this device · '+new Date().toLocaleTimeString();if(!silent)$('fileStatus').textContent='Draft saved locally in this browser.';}
    catch(e){$('saveState').textContent='Could not save draft';if(!silent)alert('The browser could not save this draft. Check available site storage.');}
  }
  function restoreDraft(){
    try{const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return;const d=JSON.parse(raw);if(![1,2,3,4,5,6].includes(d.version))return;
      if(!confirm('A saved Financial Statement Generator draft was found on this device. Would you like to restore it?'))return;
      Object.entries(d.fields||{}).forEach(([id,v])=>{if($(id))$(id).value=v;});
      $('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';
      writeRows('incomeRows',d.income);writeRows('expenseRows',d.expenses);renderSoceInputs(d.soce||{});renderCashFlowInputs(d.cashFlow||{});renderTaxInputs(d.tax||{});renderNotes(d.notes||{});setMode(d.mode||'trial-balance');
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
  $('mappingTable').addEventListener('click',e=>{const id=e.target.dataset.removeMapId;if(id)removeMappingItem(id);});
  $('approveAllMappingsBtn').addEventListener('click',approveAllMappings);
  $('addTbMappingRowBtn').addEventListener('click',()=>{$('addTbMappingRow').hidden=!$('addTbMappingRow').hidden;});
  $('confirmAddTbMappingRowBtn').addEventListener('click',addTbMappingItem);
  $('cancelAddTbMappingRowBtn').addEventListener('click',()=>{$('addTbMappingRow').hidden=true;});
  $('mainBusinessActivity').addEventListener('change',()=>{if(!$('mappingPanel').hidden)renderMappings();});
  $('framework').addEventListener('change',()=>{if(!$('mappingPanel').hidden)renderMappings();});
  $('generateStatementsBtn').addEventListener('click',generateStatements);
  $('exportExcelBtn').addEventListener('click',exportExcelWorkbook);
  $('saveDraftBtn').addEventListener('click',()=>saveDraft(false));
  $('clearDraftBtn').addEventListener('click',clearDraft);
  $('entityType').addEventListener('change',()=>{$('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';updateReview();});
  let autosaveTimer;
  function scheduleAutosave(e){if(e.target.closest('.fsg-panel')){updateReview();clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>saveDraft(true),700);}}
  document.addEventListener('input',scheduleAutosave);document.addEventListener('change',scheduleAutosave);
  ['incomeRows','expenseRows'].forEach(id=>writeRows(id,[{}]));
  renderSoceInputs();
  renderCashFlowInputs();
  $('cfInputRows').addEventListener('input',()=>saveDraft(true));
  ['cfInterestPaidPolicy','cfInterestReceivedPolicy','cfDividendsReceivedPolicy'].forEach(id=>$(id).addEventListener('change',()=>saveDraft(true)));
  $('soceInputRows').addEventListener('input',()=>{updateSoceClosings();saveDraft(true);});
  setMode('trial-balance');
  restoreDraft();
})();