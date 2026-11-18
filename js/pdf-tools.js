/* BikasB PDF Tools — all document work happens in the visitor's browser. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const tools = {
    merge:{title:'Merge PDF files',desc:'Combine multiple PDF documents into one file in the order you select them.',accept:'.pdf,application/pdf',multiple:true,upload:'Select two or more PDF files',hint:'Choose the files in the order you want them merged.',button:'Merge PDFs',fields:''},
    split:{title:'Extract / split PDF pages',desc:'Create a new PDF containing only the page numbers you specify.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Enter pages such as 1, 3-5, 8. Page numbering starts at 1.',button:'Extract pages',fields:'<div class="field"><label for="page-range">Pages to extract</label><input id="page-range" placeholder="e.g. 1, 3-5, 8"><p class="hint">Ranges and individual pages are supported.</p></div>'},
    rotate:{title:'Rotate PDF pages',desc:'Rotate every page in a PDF by 90, 180 or 270 degrees.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'All pages will be rotated by the selected angle.',button:'Rotate PDF',fields:'<div class="field"><label for="angle">Rotation</label><select id="angle"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></div>'},
    delete:{title:'Delete PDF pages',desc:'Remove unwanted pages and save the remaining pages as a new PDF.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Enter the page numbers to remove.',button:'Delete selected pages',fields:'<div class="field"><label for="page-range">Pages to delete</label><input id="page-range" placeholder="e.g. 2, 4-6"><p class="hint">At least one page must remain.</p></div>'},
    numbers:{title:'Add page numbers',desc:'Stamp simple page numbers at the bottom of every page.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Page numbers are added to the bottom centre.',button:'Add page numbers',fields:'<div class="field"><label for="start-number">Start numbering from</label><input id="start-number" type="number" min="0" value="1"><label for="number-position" style="margin-top:.7rem">Position</label><select id="number-position"><option value="bottom-center">Bottom centre</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-center">Top centre</option></select><label for="number-size" style="margin-top:.7rem">Font size</label><input id="number-size" type="number" min="6" max="36" value="10"></div><div class="live-edit-preview"><div class="live-edit-heading"><strong>Live page preview</strong><span class="hint">Changes appear as you type</span></div><div class="live-canvas-wrap"><canvas id="number-live-canvas"></canvas></div><div class="field"><label for="preview-page">Preview page</label><input id="preview-page" type="number" min="1" value="1"></div><p class="hint">This is a visual preview of the selected page. Apply changes to generate the downloadable PDF.</p></div>'},
    'images-pdf':{title:'Convert images to PDF',desc:'Combine JPG, PNG and WebP images into a single PDF, one image per page.',accept:'image/jpeg,image/png,image/webp',multiple:true,upload:'Select one or more images',hint:'Images are placed in the order selected and fitted to A4 pages.',button:'Create PDF',fields:''},
    'append-images':{title:'Add images to an existing PDF',desc:'Keep every page of an existing PDF and append selected JPG, PNG or WebP images as new pages.',accept:'.pdf,application/pdf',upload:'Select the existing PDF',hint:'Choose one PDF first, then add the images you want to append below.',button:'Add images and download PDF',fields:'<div class="field"><label for="append-image-input">Images to append</label><input id="append-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple><p class="hint">Each selected image becomes a new page at the end of the PDF.</p></div>'},
    'pdf-images':{title:'Convert PDF pages to images',desc:'Render each PDF page as a PNG image and download it separately.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Each page will be downloaded as a separate PNG.',button:'Convert to PNG',fields:'<div class="field"><label for="scale">Image quality</label><select id="scale"><option value="1">Standard</option><option value="1.5" selected>High</option><option value="2">Very high (larger files)</option></select></div>'},

    reorder:{title:'Reorder PDF pages',desc:'Arrange all pages in a new order using a comma-separated page list.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'List every page once, in the order you want. Example: 3, 1, 2, 4.',button:'Reorder pages',fields:'<div class="field"><label for="page-range">New page order</label><input id="page-range" placeholder="e.g. 3, 1, 2, 4"><p class="hint">Use every page number exactly once.</p></div>'},
    duplicate:{title:'Duplicate PDF pages',desc:'Copy selected pages and insert the copies immediately after each original.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Enter the page numbers you want to duplicate.',button:'Duplicate pages',fields:'<div class="field"><label for="page-range">Pages to duplicate</label><input id="page-range" placeholder="e.g. 1, 3-4"></div>'},
    blank:{title:'Insert blank PDF pages',desc:'Insert blank pages after the page numbers you specify.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Enter the page numbers after which a blank page should be inserted.',button:'Insert blank pages',fields:'<div class="field"><label for="page-range">Insert after pages</label><input id="page-range" placeholder="e.g. 1, 3-4"><p class="hint">Blank pages use the dimensions of the preceding page.</p></div>'},
    textstamp:{title:'Add text or watermark',desc:'Design a text label or watermark, position it on a page preview, and apply it across your PDF.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Click or drag on the preview to position the text. The same position and style are applied to every page.',button:'Apply text / watermark',fields:'<div class="field"><label for="stamp-text">Text</label><input id="stamp-text" maxlength="120" placeholder="CONFIDENTIAL" value="CONFIDENTIAL"><label for="stamp-size" style="margin-top:.7rem">Font size</label><input id="stamp-size" type="range" min="12" max="72" value="36"><label for="stamp-color" style="margin-top:.7rem">Text colour</label><input id="stamp-color" type="color" value="#666666"><label for="stamp-opacity" style="margin-top:.7rem">Opacity</label><input id="stamp-opacity" type="range" min="5" max="100" value="25"><label for="stamp-rotation" style="margin-top:.7rem">Rotation</label><input id="stamp-rotation" type="range" min="-90" max="90" value="-35"><label for="stamp-mode" style="margin-top:.7rem">Placement preset</label><select id="stamp-mode"><option value="custom">Custom position (click/drag preview)</option><option value="watermark">Diagonal centre</option><option value="footer">Bottom centre</option><option value="header">Top centre</option></select></div><div class="live-edit-preview"><div class="live-edit-heading"><strong>Live watermark preview</strong><span class="hint">Click or drag the text to position it</span></div><div class="live-canvas-wrap"><canvas id="stamp-live-canvas" aria-label="Interactive watermark position preview"></canvas></div><div class="field"><label for="stamp-preview-page">Preview page</label><input id="stamp-preview-page" type="number" min="1" value="1"></div><p class="hint">Preview is illustrative; final placement is applied to every page. Text becomes part of the PDF page, not an editable text field.</p></div>'},
    'image-overlay':{title:'Place image or signature on PDF',desc:'Insert a logo, stamp or signature image onto a selected PDF page. Position and resize it using the live preview.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Choose a PDF, then upload a transparent PNG or JPG signature/logo.',button:'Apply image to PDF',fields:'<div class="field"><label for="overlay-image">Image or signature (PNG/JPG/WebP)</label><input id="overlay-image" type="file" accept="image/png,image/jpeg,image/webp"><label for="overlay-size" style="margin-top:.7rem">Image width (% of page)</label><input id="overlay-size" type="range" min="5" max="70" value="25"><label for="overlay-page" style="margin-top:.7rem">PDF page to edit</label><input id="overlay-page" type="number" min="1" value="1"></div><div class="live-edit-preview"><div class="live-edit-heading"><strong>Image placement preview</strong><span class="hint">Drag the image to position it</span></div><div class="live-canvas-wrap"><canvas id="overlay-live-canvas"></canvas></div><p class="hint">The image is added to the selected page only. Transparent PNG backgrounds are preserved where supported.</p></div>'},
    metadata:{title:'PDF information & metadata',desc:'Inspect page count, page dimensions, title, author, subject and creator metadata.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'The report is generated locally. Password-protected files may not open.',button:'Inspect PDF',fields:''},
    extract:{title:'Extract selected pages',desc:'Save a selected set of pages as a separate PDF.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Enter pages such as 1, 3-5, 8.',button:'Extract pages',fields:'<div class="field"><label for="page-range">Pages to extract</label><input id="page-range" placeholder="e.g. 1, 3-5, 8"></div>'}
,
    text:{title:'Extract text from PDF',desc:'Extract selectable text from a PDF and download it as a plain text file.',accept:'.pdf,application/pdf',upload:'Select one PDF file',hint:'Scanned pages without a text layer require OCR and may return little or no text.',button:'Extract text',fields:''}
  };
  let current='merge';
  const input=$('file-input'),options=$('options-area'),run=$('run-tool'),status=$('tool-status');
  const setStatus=(message,type='')=>{status.textContent=message;status.className='status '+type;};
  const getFiles=()=>Array.from(input.files||[]);
  const checkFiles=(files)=>{if(!files.length)throw Error('Please select a file first.');const total=files.reduce((n,f)=>n+f.size,0);if(total>50*1024*1024)throw Error('Please keep the total file size below 50 MB for reliable browser processing.');};
  const read=async file=>new Uint8Array(await file.arrayBuffer());
  // Decode each selected image fully and normalise it to a white-backed JPEG.
  // This avoids browser-specific PNG/WebP decoding differences that can produce empty pages.
  async function embedImage(pdf, file) {
    const type = (file.type || '').toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (type && !['image/jpeg','image/png','image/webp'].includes(type)) {
      throw Error('Unsupported image format: ' + file.name + '. Use JPG, PNG or WebP.');
    }
    if (!type && !['jpg','jpeg','png','webp'].includes(ext)) {
      throw Error('Unsupported image format: ' + file.name + '. Use JPG, PNG or WebP.');
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (_) {
      throw Error('The image "' + file.name + '" could not be decoded. Try saving it as JPG or PNG and upload it again.');
    }
    try {
      if (!bitmap.width || !bitmap.height) throw Error('The image "' + file.name + '" has invalid dimensions.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('Your browser could not prepare the image for PDF conversion.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
      if (!blob || !blob.size) throw Error('The image "' + file.name + '" could not be converted.');
      const embedded = await pdf.embedJpg(await read(blob));
      if (!embedded.width || !embedded.height) throw Error('The image "' + file.name + '" produced an empty image.');
      return embedded;
    } finally {
      bitmap.close();
    }
  }

  function appendImagePage(pdf, image) {
    const pageWidth = 595.28, pageHeight = 841.89;
    const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height
    });
  }
  const download=(bytes,name,type='application/pdf')=>{const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
  let outputPreviewUrl=null;
  function previewPdf(bytes,name){
    if(outputPreviewUrl)URL.revokeObjectURL(outputPreviewUrl);
    const blob=new Blob([bytes],{type:'application/pdf'});
    outputPreviewUrl=URL.createObjectURL(blob);
    $('pdf-preview-frame').src=outputPreviewUrl;
    $('pdf-preview-name').textContent=name;
    $('pdf-preview-download').onclick=()=>download(bytes,name);
    $('pdf-preview-area').classList.remove('hidden');
    $('pdf-preview-area').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('pdf-preview-close').addEventListener('click',()=>{
    $('pdf-preview-frame').src='about:blank';
    $('pdf-preview-area').classList.add('hidden');
    if(outputPreviewUrl)URL.revokeObjectURL(outputPreviewUrl);
    outputPreviewUrl=null;
  });
  function parsePages(value,count){const set=new Set();value.split(',').map(x=>x.trim()).filter(Boolean).forEach(part=>{const m=part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw Error('Invalid page range. Use a format such as 1, 3-5, 8.');const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b<a||b>count)throw Error('Page numbers must be between 1 and '+count+'.');for(let n=a;n<=b;n++)set.add(n-1);});if(!set.size)throw Error('Enter at least one page number.');return [...set].sort((a,b)=>a-b);}

  let livePreviewDoc=null,livePreviewFile=null,livePreviewTask=null;
  async function renderNumberLivePreview(){
    const canvas=$('number-live-canvas');if(!canvas||!livePreviewDoc)return;
    if(livePreviewTask){try{livePreviewTask.cancel();}catch(_){}}
    const pageNo=Math.max(1,Math.min(livePreviewDoc.numPages,Number($('preview-page')?.value)||1));
    if($('preview-page'))$('preview-page').max=livePreviewDoc.numPages;
    const page=await livePreviewDoc.getPage(pageNo),viewport=page.getViewport({scale:1.25});
    canvas.width=viewport.width;canvas.height=viewport.height;
    const ctx=canvas.getContext('2d');
    livePreviewTask=page.render({canvasContext:ctx,viewport});
    try{await livePreviewTask.promise;}catch(e){if(e.name==='RenderingCancelledException')return;throw e;}
    const start=Math.max(0,Number($('start-number')?.value)||0),label=String(start+pageNo-1);
    const size=Math.max(6,Math.min(36,Number($('number-size')?.value)||10))*1.25;
    const margin=22,position=$('number-position')?.value||'bottom-center';
    ctx.save();ctx.font=size+'px Helvetica, Arial, sans-serif';ctx.fillStyle='#595959';ctx.textBaseline='alphabetic';
    const w=ctx.measureText(label).width;
    let x=(canvas.width-w)/2,y=canvas.height-margin;
    if(position==='bottom-left')x=margin;
    if(position==='bottom-right')x=canvas.width-margin-w;
    if(position==='top-center')y=margin+size;
    ctx.fillText(label,x,y);ctx.restore();
  }
  async function loadNumberLivePreview(file){
    livePreviewDoc=null;livePreviewFile=file;
    if(!file||!window.pdfjsLib)return;
    try{
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      livePreviewDoc=await pdfjsLib.getDocument({data:await read(file)}).promise;
      await renderNumberLivePreview();
    }catch(e){setStatus('Live preview could not load this PDF: '+(e.message||'Unknown error'),'error');}
  }
  let stampPreviewDoc=null,stampPosition={x:.5,y:.5},stampDragging=false;
  function stampStyle(){
    const mode=$('stamp-mode')?.value||'custom';
    if(mode==='footer')stampPosition={x:.5,y:.965};
    else if(mode==='header')stampPosition={x:.5,y:.06};
    else if(mode==='watermark')stampPosition={x:.5,y:.5};
    return {text:$('stamp-text')?.value||'CONFIDENTIAL',size:Number($('stamp-size')?.value)||36,color:$('stamp-color')?.value||'#666666',opacity:(Number($('stamp-opacity')?.value)||25)/100,rotation:Number($('stamp-rotation')?.value)||0};
  }
  function hexRgb(hex){const v=parseInt((hex||'#666666').replace('#',''),16);return {r:((v>>16)&255)/255,g:((v>>8)&255)/255,b:(v&255)/255};}
  async function renderStampLivePreview(){
    const canvas=$('stamp-live-canvas');if(!canvas||!stampPreviewDoc)return;
    const pageNo=Math.max(1,Math.min(stampPreviewDoc.numPages,Number($('stamp-preview-page')?.value)||1));
    if($('stamp-preview-page'))$('stamp-preview-page').max=stampPreviewDoc.numPages;
    const page=await stampPreviewDoc.getPage(pageNo),viewport=page.getViewport({scale:1.25});
    canvas.width=viewport.width;canvas.height=viewport.height;
    const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;
    const st=stampStyle(),x=stampPosition.x*canvas.width,y=stampPosition.y*canvas.height;
    ctx.save();ctx.translate(x,y);ctx.rotate(st.rotation*Math.PI/180);ctx.globalAlpha=st.opacity;ctx.fillStyle=st.color;
    ctx.font='bold '+(st.size*1.25)+'px Helvetica, Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(st.text,0,0);ctx.restore();
  }
  async function loadStampLivePreview(file){
    stampPreviewDoc=null;if(!file||!window.pdfjsLib)return;
    try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';stampPreviewDoc=await pdfjsLib.getDocument({data:await read(file)}).promise;await renderStampLivePreview();}
    catch(e){setStatus('Watermark preview could not load this PDF: '+(e.message||'Unknown error'),'error');}
  }
  function setStampPositionFromPointer(e){
    const canvas=$('stamp-live-canvas'),rect=canvas.getBoundingClientRect();
    stampPosition={x:Math.max(.02,Math.min(.98,(e.clientX-rect.left)/rect.width)),y:Math.max(.02,Math.min(.98,(e.clientY-rect.top)/rect.height))};
    renderStampLivePreview().catch(err=>setStatus(err.message,'error'));
  }
    let overlayPreviewDoc=null,overlayBitmap=null,overlayPosition={x:.5,y:.5},overlayDragging=false;
  async function renderOverlayPreview(){
    const canvas=$('overlay-live-canvas');if(!canvas||!overlayPreviewDoc)return;
    const pageNo=Math.max(1,Math.min(overlayPreviewDoc.numPages,Number($('overlay-page')?.value)||1));
    if($('overlay-page'))$('overlay-page').max=overlayPreviewDoc.numPages;
    const page=await overlayPreviewDoc.getPage(pageNo),viewport=page.getViewport({scale:1.25});
    canvas.width=viewport.width;canvas.height=viewport.height;
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    if(overlayBitmap){
      const width=canvas.width*(Math.max(5,Math.min(70,Number($('overlay-size')?.value)||25))/100);
      const height=width*overlayBitmap.height/overlayBitmap.width;
      canvas.getContext('2d').drawImage(overlayBitmap,overlayPosition.x*canvas.width-width/2,overlayPosition.y*canvas.height-height/2,width,height);
    }
  }
  async function loadOverlayPreview(file){
    overlayPreviewDoc=null;if(!file||!window.pdfjsLib)return;
    try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';overlayPreviewDoc=await pdfjsLib.getDocument({data:await read(file)}).promise;await renderOverlayPreview();}
    catch(e){setStatus('Image placement preview could not load this PDF: '+(e.message||'Unknown error'),'error');}
  }
  function setOverlayPosition(e){
    const canvas=$('overlay-live-canvas'),rect=canvas.getBoundingClientRect();
    overlayPosition={x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))};
    renderOverlayPreview().catch(err=>setStatus(err.message,'error'));
  }
    function configure(key){current=key;const t=tools[key];document.querySelectorAll('.tool-choice').forEach(b=>b.classList.toggle('active',b.dataset.tool===key));$('tool-title').textContent=t.title;$('tool-description').textContent=t.desc;$('upload-title').textContent=t.upload;$('upload-hint').textContent=t.hint;input.accept=t.accept;input.multiple=!!t.multiple;input.value='';livePreviewDoc=null;stampPreviewDoc=null;stampPosition={x:.5,y:.5};overlayPreviewDoc=null;overlayBitmap=null;overlayPosition={x:.5,y:.5};options.innerHTML=t.fields;run.textContent=t.button;setStatus('Select your file(s) to get started.');}
  document.querySelectorAll('.tool-choice').forEach(b=>b.addEventListener('click',()=>configure(b.dataset.tool)));
  input.addEventListener('change',()=>{if(getFiles().length===1){if(current==='numbers')loadNumberLivePreview(getFiles()[0]);if(current==='textstamp')loadStampLivePreview(getFiles()[0]);if(current==='image-overlay')loadOverlayPreview(getFiles()[0]);}});
  options.addEventListener('change',e=>{if(current==='image-overlay'&&e.target.id==='overlay-image'){const file=e.target.files?.[0];if(overlayBitmap)overlayBitmap.close?.();overlayBitmap=null;if(file)createImageBitmap(file).then(bitmap=>{overlayBitmap=bitmap;renderOverlayPreview();}).catch(()=>setStatus('Could not read that image. Try a PNG or JPG file.','error'));}if(current==='image-overlay'&&e.target.id==='overlay-page')renderOverlayPreview().catch(err=>setStatus(err.message,'error'));});
  options.addEventListener('input',e=>{if(current==='numbers'&&['start-number','number-size','preview-page'].includes(e.target.id))renderNumberLivePreview().catch(err=>setStatus(err.message,'error'));if(current==='textstamp'&&['stamp-text','stamp-size','stamp-color','stamp-opacity','stamp-rotation','stamp-preview-page'].includes(e.target.id))renderStampLivePreview().catch(err=>setStatus(err.message,'error'));if(current==='image-overlay'&&e.target.id==='overlay-size')renderOverlayPreview().catch(err=>setStatus(err.message,'error'));});
  options.addEventListener('change',e=>{if(current==='numbers'&&e.target.id==='number-position')renderNumberLivePreview().catch(err=>setStatus(err.message,'error'));if(current==='textstamp'&&e.target.id==='stamp-mode')renderStampLivePreview().catch(err=>setStatus(err.message,'error'));});
  options.addEventListener('pointerdown',e=>{if(current==='image-overlay'&&e.target.id==='overlay-live-canvas'&&overlayBitmap){overlayDragging=true;e.target.setPointerCapture?.(e.pointerId);setOverlayPosition(e);}if(current==='textstamp'&&e.target.id==='stamp-live-canvas'){stampDragging=true;e.target.setPointerCapture?.(e.pointerId);setStampPositionFromPointer(e);}});
  options.addEventListener('pointermove',e=>{if(current==='image-overlay'&&overlayDragging&&e.target.id==='overlay-live-canvas')setOverlayPosition(e);if(current==='textstamp'&&stampDragging&&e.target.id==='stamp-live-canvas')setStampPositionFromPointer(e);});
  options.addEventListener('pointerup',()=>{stampDragging=false;overlayDragging=false;});
  options.addEventListener('pointercancel',()=>{stampDragging=false;overlayDragging=false;});
  run.addEventListener('click',async()=>{const files=getFiles();try{checkFiles(files);run.disabled=true;setStatus('Processing your document…');const {PDFDocument,StandardFonts,rgb,degrees}=PDFLib;
    if(current==='merge'){if(files.length<2)throw Error('Select at least two PDF files to merge.');const out=await PDFDocument.create();for(const f of files){const src=await PDFDocument.load(await read(f));const pages=await out.copyPages(src,src.getPageIndices());pages.forEach(p=>out.addPage(p));}previewPdf(await out.save(),'merged-document.pdf');}
    if(current==='split'||current==='delete'||current==='rotate'||current==='numbers'){if(files.length!==1)throw Error('Please select exactly one PDF file.');const src=await PDFDocument.load(await read(files[0]));const count=src.getPageCount();
      if(current==='split'||current==='delete'){const selected=parsePages($('page-range').value,count);const indices=current==='split'?selected:Array.from({length:count},(_,i)=>i).filter(i=>!selected.includes(i));if(!indices.length)throw Error('You cannot delete every page.');const out=await PDFDocument.create();const pages=await out.copyPages(src,indices);pages.forEach(p=>out.addPage(p));previewPdf(await out.save(),current==='split'?'extracted-pages.pdf':'pages-removed.pdf');}
      if(current==='rotate'){const angle=Number($('angle').value);src.getPages().forEach(p=>p.setRotation(degrees((p.getRotation().angle+angle)%360)));previewPdf(await src.save(),'rotated-document.pdf');}
      if(current==='numbers'){
        const font=await src.embedFont(StandardFonts.Helvetica),start=Math.max(0,Number($('start-number').value)||0),size=Math.max(6,Math.min(36,Number($('number-size').value)||10)),position=$('number-position').value;
        src.getPages().forEach((p,i)=>{const {width,height}=p.getSize(),label=String(start+i),w=font.widthOfTextAtSize(label,size),margin=22;
          let x=(width-w)/2,y=margin;
          if(position==='bottom-left')x=margin;
          if(position==='bottom-right')x=width-margin-w;
          if(position==='top-center')y=height-margin-size;
          p.drawText(label,{x,y,size,font,color:rgb(.35,.35,.35)});
        });
        previewPdf(await src.save(),'numbered-document.pdf');
      }
    }

    if(['reorder','duplicate','blank','textstamp','metadata','extract','image-overlay'].includes(current)){
      if(files.length!==1)throw Error('Please select exactly one PDF file.');
      const src=await PDFDocument.load(await read(files[0]));
      const count=src.getPageCount();
      if(current==='image-overlay'){
        const imageFile=$('overlay-image')?.files?.[0];if(!imageFile)throw Error('Select a PNG, JPG or WebP image first.');
        const pageNo=Number($('overlay-page').value)||1;if(pageNo<1||pageNo>count)throw Error('Choose a valid PDF page number.');
        const embedded=await embedImage(src,imageFile),page=src.getPage(pageNo-1),{width,height}=page.getSize();
        const imageWidth=width*(Math.max(5,Math.min(70,Number($('overlay-size').value)||25))/100),imageHeight=imageWidth*embedded.height/embedded.width;
        const x=overlayPosition.x*width-imageWidth/2,y=height-overlayPosition.y*height-imageHeight/2;
        page.drawImage(embedded,{x,y,width:imageWidth,height:imageHeight});
        previewPdf(await src.save(),'pdf-with-image-or-signature.pdf');
      }
      if(current==='metadata'){
        const info={file:files[0].name,size:(files[0].size/1024).toFixed(1)+' KB',pages:count,title:src.getTitle()||'—',author:src.getAuthor()||'—',subject:src.getSubject()||'—',creator:src.getCreator()||'—',producer:src.getProducer()||'—',created:src.getCreationDate()?.toLocaleString()||'—',modified:src.getModificationDate()?.toLocaleString()||'—'};
        const report=Object.entries(info).map(([k,v])=>k.toUpperCase()+': '+v).join('\n');
        const pre=document.createElement('pre');pre.className='metadata-report';pre.textContent=report;
        $('metadata-result')?.remove();pre.id='metadata-result';options.appendChild(pre);
      }
      if(current==='extract'){
        const indices=parsePages($('page-range').value,count),out=await PDFDocument.create(),pages=await out.copyPages(src,indices);pages.forEach(p=>out.addPage(p));previewPdf(await out.save(),'extracted-pages.pdf');
      }
      if(current==='reorder'){
        const raw=$('page-range').value.split(',').map(x=>x.trim()).filter(Boolean);
        const indices=raw.map(x=>{if(!/^\d+$/.test(x))throw Error('Enter page numbers separated by commas, e.g. 3, 1, 2.');const n=Number(x);if(n<1||n>count)throw Error('Page numbers must be between 1 and '+count+'.');return n-1;});
        if(indices.length!==count||new Set(indices).size!==count)throw Error('List every page exactly once. Expected '+count+' unique page numbers.');
        const out=await PDFDocument.create(),pages=await out.copyPages(src,indices);pages.forEach(p=>out.addPage(p));previewPdf(await out.save(),'reordered-pages.pdf');
      }
      if(current==='duplicate'){
        const selected=parsePages($('page-range').value,count),out=await PDFDocument.create();
        for(let i=0;i<count;i++){const [p]=await out.copyPages(src,[i]);out.addPage(p);if(selected.includes(i)){const [copy]=await out.copyPages(src,[i]);out.addPage(copy);}}
        previewPdf(await out.save(),'duplicated-pages.pdf');
      }
      if(current==='blank'){
        const selected=parsePages($('page-range').value,count),out=await PDFDocument.create();
        for(let i=0;i<count;i++){const [p]=await out.copyPages(src,[i]);out.addPage(p);if(selected.includes(i)){const size=p.getSize();out.addPage([size.width,size.height]);}}
        previewPdf(await out.save(),'document-with-blank-pages.pdf');
      }
      if(current==='textstamp'){
        const st=stampStyle(),value=st.text.trim();if(!value)throw Error('Enter the text to add.');
        const font=await src.embedFont(StandardFonts.HelveticaBold),colour=hexRgb(st.color);
        src.getPages().forEach(p=>{const {width,height}=p.getSize(),size=Math.max(8,Math.min(100,st.size)),w=font.widthOfTextAtSize(value,size);
          const x=Math.max(0,Math.min(width,stampPosition.x*width)),y=Math.max(0,Math.min(height,stampPosition.y*height));
          p.drawText(value,{x:x-w/2,y:y-size/2,size,font,color:rgb(colour.r,colour.g,colour.b),opacity:st.opacity,rotate:degrees(st.rotation)});
        });previewPdf(await src.save(),'text-watermarked.pdf');
      }
    }
    if(current==='append-images'){
      if(files.length!==1)throw Error('Please select exactly one existing PDF file.');
      const images=Array.from($('append-image-input')?.files||[]);
      if(!images.length)throw Error('Please select at least one image to append.');
      checkFiles([files[0], ...images]);
      const out=await PDFDocument.load(await read(files[0]));
      for(const file of images){
        const embedded=await embedImage(out,file);
        appendImagePage(out,embedded);
      }
      previewPdf(await out.save(),'pdf-with-added-images.pdf');
    }
    if(current==='images-pdf'){
      if(!files.length)throw Error('Please select at least one image.');
      const out=await PDFDocument.create();
      for(const file of files){
        const embedded=await embedImage(out,file);
        appendImagePage(out,embedded);
      }
      if(out.getPageCount()!==files.length)throw Error('The PDF could not be created with one page per image. Please try again.');
      previewPdf(await out.save(),'images-to-pdf.pdf');
    }
    if(current==='pdf-images'){if(files.length!==1)throw Error('Please select exactly one PDF file.');if(!window.pdfjsLib)throw Error('PDF renderer could not load. Refresh and try again.');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';const doc=await pdfjsLib.getDocument({data:await read(files[0])}).promise,scale=Number($('scale').value);for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const blob=await new Promise(res=>canvas.toBlob(res,'image/png'));download(await read(blob),'page-'+n+'.png','image/png');} }
    if(current==='text'){if(files.length!==1)throw Error('Please select exactly one PDF file.');if(!window.pdfjsLib)throw Error('PDF text engine could not load. Refresh and try again.');pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';const doc=await pdfjsLib.getDocument({data:await read(files[0])}).promise;let text='';for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();text+='\n\n--- Page '+n+' ---\n'+content.items.map(x=>x.str).join(' ');}if(!text.replace(/[-\s]/g,''))throw Error('No selectable text was found. This may be a scanned PDF; OCR is not included in this starter version.');download(new TextEncoder().encode(text.trim()),'extracted-text.txt','text/plain;charset=utf-8');}
    if(outputPreviewUrl)setStatus('PDF ready. Review the preview below, then choose Download PDF when you are satisfied. Your original files were not uploaded.','success');else setStatus('Done! Your file download should begin automatically. Your original files were not uploaded.','success');
  }catch(e){setStatus(e.message||'Something went wrong while processing the file.', 'error');}finally{run.disabled=false;}});
  configure('merge');
})();