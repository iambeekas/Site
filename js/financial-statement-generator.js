/* Financial Statement Generator — browser-only intake and draft persistence */
(function(){
  'use strict';
  const DRAFT_KEY='bikasb_fsg_draft_v2';
  const PROFILE_KEY='bikasb_fsg_mapping_profiles_v1';
  const $=id=>document.getElementById(id);
  const state={mode:'trial-balance',workbook:null,rows:[],headers:[],headerRow:0,fileName:'',mappings:{},mappingItems:[]};
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
    checks.push({kind:'warn',text:'Tax reconciliation and note disclosures are not yet calculated in this stage. Cash-flow supplementary inputs are required for a complete IAS 7 statement; comparative SOCE movements are not yet supported.'});
    const output=cashFlowTable(current,comparative,comparativeProvided)+soceOutput(current,comparative,comparativeProvided)+statementTable('Statement of Financial Position',currentRows,current.assets,comparative.assets,false)+
      statementTable('Statement of Profit or Loss',plRows,current.profit,comparative.profit,false)+
      statementTable('Statement of Comprehensive Income',ociRows,current.comprehensive,comparative.comprehensive,false)+
      '<div class="fsg-statement-card"><h3>Validation checks</h3><div class="fsg-statement-checks">'+checks.map(x=>'<div class="fsg-statement-check '+x.kind+'">'+escapeHtml(x.text)+'</div>').join('')+'</div><p class="fsg-period-note">A balanced statement is a mathematical check only; it is not evidence of IFRS compliance or completeness.</p></div>';
    $('statementOutput').innerHTML=output;$('statementOutput').hidden=false;
    $('statementStatus').innerHTML='<strong>Working statements generated.</strong> '+(comparativeProvided?'Current and comparative figures are displayed.':'Current-period figures are displayed; comparative data was not detected.')+' Review the validation checks and source mappings.';
    $('statementOutput').scrollIntoView({behavior:'smooth',block:'start'});
  }



  const CF_FIELDS=[
    ['openingCash','Opening cash and cash equivalents'],
    ['depreciation','Depreciation and amortisation added back'],
    ['impairment','Impairment losses added back'],
    ['provisionMovement','Increase / (decrease) in provisions'],
    ['lossDisposal','Loss on disposal of non-current assets added back'],
    ['gainDisposal','Gain on disposal of non-current assets deducted'],
    ['receivablesChange','Change in trade and other receivables (signed)'],
    ['inventoryChange','Change in inventories (signed)'],
    ['otherOperatingAssetsChange','Change in other operating assets (signed)'],
    ['payablesChange','Change in trade and other payables (signed)'],
    ['otherOperatingLiabilitiesChange','Change in other operating liabilities (signed)'],
    ['taxPaid','Income taxes paid'],
    ['interestPaid','Interest paid'],
    ['interestReceived','Interest received'],
    ['dividendsReceived','Dividends received'],
    ['ppePurchases','Purchases of property, plant and equipment'],
    ['ppeProceeds','Proceeds from disposal of property, plant and equipment'],
    ['intangiblePurchases','Purchases of intangible assets'],
    ['investmentPurchases','Purchases of investments'],
    ['investmentProceeds','Proceeds from disposal of investments'],
    ['dividendsPaid','Dividends paid'],
    ['borrowingsProceeds','Proceeds from borrowings'],
    ['borrowingsRepayments','Repayment of borrowings'],
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

  function calculateCashFlow(period,totals){
    const data=readCashFlow(),v=k=>num(data[period][k])||0;
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
    return {operatingProfit,adjustments,working,cashGenerated,tax,operatingInterestPaid,financingInterestPaid,operatingInterestReceived,investingInterestReceived,operatingDividendsReceived,investingDividendsReceived,operating,investing,financing,net,fx,opening,closing,sofpCash,difference:closing-sofpCash,hasInputs:Object.values(data[period]).some(x=>x!=='')};
  }
  function cashFlowTable(current,comparative,comparativeProvided){
    const c1=calculateCashFlow('current',current),c2=calculateCashFlow('comparative',comparative);
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
      ['Purchases of property, plant and equipment',x=>- (num(readCashFlow().current.ppePurchases)||0)],
      ['Proceeds from disposal of property, plant and equipment',x=>num(readCashFlow().current.ppeProceeds)||0],
      ['Purchases of intangible assets',x=>-(num(readCashFlow().current.intangiblePurchases)||0)],
      ['Purchases of investments',x=>-(num(readCashFlow().current.investmentPurchases)||0)],
      ['Proceeds from disposal of investments',x=>num(readCashFlow().current.investmentProceeds)||0],
      ['Interest received (investing classification)',x=>x.investingInterestReceived],
      ['Dividends received (investing classification)',x=>x.investingDividendsReceived],
      ['Net cash from / (used in) investing activities',x=>x.investing],
      ['Interest paid (financing classification)',x=>x.financingInterestPaid],
      ['Proceeds from borrowings',x=>num(readCashFlow().current.borrowingsProceeds)||0],
      ['Repayment of borrowings',x=>-(num(readCashFlow().current.borrowingsRepayments)||0)],
      ['Repayment of lease liabilities',x=>-(num(readCashFlow().current.leasePrincipal)||0)],
      ['Proceeds from issue of shares',x=>num(readCashFlow().current.shareIssueProceeds)||0],
      ['Owner / partner capital contributions',x=>num(readCashFlow().current.ownerContributions)||0],
      ['Dividends / owner distributions paid',x=>-(num(readCashFlow().current.dividendsPaid)||0)-(num(readCashFlow().current.ownerDrawings)||0)],
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
      if(key==='Purchases of property, plant and equipment')return -(num(cfData.comparative.ppePurchases)||0);
      if(key==='Proceeds from disposal of property, plant and equipment')return num(cfData.comparative.ppeProceeds)||0;
      if(key==='Purchases of intangible assets')return -(num(cfData.comparative.intangiblePurchases)||0);
      if(key==='Purchases of investments')return -(num(cfData.comparative.investmentPurchases)||0);
      if(key==='Proceeds from disposal of investments')return num(cfData.comparative.investmentProceeds)||0;
      if(key==='Proceeds from borrowings')return num(cfData.comparative.borrowingsProceeds)||0;
      if(key==='Repayment of borrowings')return -(num(cfData.comparative.borrowingsRepayments)||0);
      if(key==='Repayment of lease liabilities')return -(num(cfData.comparative.leasePrincipal)||0);
      if(key==='Proceeds from issue of shares')return num(cfData.comparative.shareIssueProceeds)||0;
      if(key==='Owner / partner capital contributions')return num(cfData.comparative.ownerContributions)||0;
      if(key==='Dividends / owner distributions paid')return -(num(cfData.comparative.dividendsPaid)||0)-(num(cfData.comparative.ownerDrawings)||0);
      return line[1](c2);
    };
    const rows=lines.map((line,i)=>'<tr class="'+(['Cash generated from operations','Net cash from / (used in) operating activities','Net cash from / (used in) investing activities','Net cash from / (used in) financing activities','Net increase / (decrease) before exchange differences','Cash and cash equivalents at end of period'].includes(line[0])?'total':'')+'"><td>'+line[0]+'</td><td>'+fmt(value(c1,0,line))+'</td>'+(comparativeProvided?'<td>'+fmt(value(c2,1,line))+'</td>':'')+'</tr>').join('');
    const htmlOut='<article class="fsg-statement-card"><h3>Statement of Cash Flows</h3><table><thead><tr><th>Particulars</th><th>Current period</th>'+(comparativeProvided?'<th>Comparative</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table><p class="fsg-period-note">Prepared using the indirect method, starting from operating profit. Payments and purchases are deducted; working-capital changes are entered as signed amounts. Review classifications and non-cash transactions before use.</p></article>';
    const status=[];
    [['Current',c1],['Comparative',c2]].forEach(([name,x])=>{
      if(name==='Comparative'&&!comparativeProvided)return;
      status.push('<div class="fsg-statement-check '+(Math.abs(x.difference)<0.005?'ok':'warn')+'">'+name+' cash-flow closing balance: '+fmt(x.closing)+'; SOFP cash: '+fmt(x.sofpCash)+'; difference: '+fmt(x.difference)+(Math.abs(x.difference)<0.005?' — reconciles.':' — does not reconcile. Check opening cash and supplementary movements.')+'</div>');
      if(!x.hasInputs)status.push('<div class="fsg-statement-check warn">'+name+': no supplementary cash-flow information entered.</div>');
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
  function collectDraft(){return {version:4,soce:readSoce(),cashFlow:readCashFlow(),savedAt:new Date().toISOString(),mode:state.mode,fields:readFields(),income:readRows('incomeRows'),expenses:readRows('expenseRows'),fileName:state.fileName,imported:state.imported||null,mappings:state.mappings};}
  function saveDraft(silent){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify(collectDraft()));$('saveState').textContent='Saved on this device · '+new Date().toLocaleTimeString();if(!silent)$('fileStatus').textContent='Draft saved locally in this browser.';}
    catch(e){$('saveState').textContent='Could not save draft';if(!silent)alert('The browser could not save this draft. Check available site storage.');}
  }
  function restoreDraft(){
    try{const raw=localStorage.getItem(DRAFT_KEY);if(!raw)return;const d=JSON.parse(raw);if(![1,2,3,4].includes(d.version))return;
      if(!confirm('A saved Financial Statement Generator draft was found on this device. Would you like to restore it?'))return;
      Object.entries(d.fields||{}).forEach(([id,v])=>{if($(id))$(id).value=v;});
      $('soleTraderEquity').hidden=$('entityType').value!=='sole-trader';$('partnershipEquity').hidden=$('entityType').value!=='partnership';$('companyEquity').hidden=$('entityType').value!=='company';
      writeRows('incomeRows',d.income);writeRows('expenseRows',d.expenses);renderSoceInputs(d.soce||{});renderCashFlowInputs(d.cashFlow||{});setMode(d.mode||'trial-balance');
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