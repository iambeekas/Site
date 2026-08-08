/**
 * Shared Contentful helpers for bikasb.com.np
 * Content type: myPersonalBlog
 * Required fields today: title, content (RichText)
 * Optional (add in Contentful for better UX): category, description, slug
 */
(function (global) {
  const SPACE_ID = 'd1c7q2jyz0do';
  const ACCESS_TOKEN = 'ULXUDAh4jQrf6fLuHPr9ec2G_K4fHk23gV3K8LEr-yk';
  const CONTENT_TYPE = 'myPersonalBlog';

  function getClient() {
    if (typeof contentful === 'undefined') {
      throw new Error('Contentful SDK not loaded. Include contentful.browser.min.js first.');
    }
    return contentful.createClient({ space: SPACE_ID, accessToken: ACCESS_TOKEN });
  }

  /** Convert Contentful Rich Text document to simple HTML */
  function richTextToHtml(doc) {
    if (!doc || !doc.content) return '';
    return doc.content.map(nodeToHtml).join('');
  }

  function nodeToHtml(node) {
    if (!node) return '';
    switch (node.nodeType) {
      case 'paragraph':
        return '<p>' + (node.content || []).map(nodeToHtml).join('') + '</p>';
      case 'heading-1':
        return '<h1>' + (node.content || []).map(nodeToHtml).join('') + '</h1>';
      case 'heading-2':
        return '<h2>' + (node.content || []).map(nodeToHtml).join('') + '</h2>';
      case 'heading-3':
        return '<h3>' + (node.content || []).map(nodeToHtml).join('') + '</h3>';
      case 'unordered-list':
        return '<ul>' + (node.content || []).map(nodeToHtml).join('') + '</ul>';
      case 'ordered-list':
        return '<ol>' + (node.content || []).map(nodeToHtml).join('') + '</ol>';
      case 'list-item':
        return '<li>' + (node.content || []).map(nodeToHtml).join('') + '</li>';
      case 'blockquote':
        return '<blockquote>' + (node.content || []).map(nodeToHtml).join('') + '</blockquote>';
      case 'hr':
        return '<hr/>';
      case 'text': {
        let t = escapeHtml(node.value || '');
        (node.marks || []).forEach(function (m) {
          if (m.type === 'bold') t = '<strong>' + t + '</strong>';
          if (m.type === 'italic') t = '<em>' + t + '</em>';
          if (m.type === 'underline') t = '<u>' + t + '</u>';
          if (m.type === 'code') t = '<code>' + t + '</code>';
        });
        return t;
      }
      case 'hyperlink':
        return '<a href="' + escapeHtml((node.data && node.data.uri) || '#') + '" target="_blank" rel="noopener">' +
          (node.content || []).map(nodeToHtml).join('') + '</a>';
      default:
        return (node.content || []).map(nodeToHtml).join('');
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function plainTextFromRichText(doc, maxLen) {
    function walk(n) {
      if (!n) return '';
      if (n.nodeType === 'text') return n.value || '';
      return (n.content || []).map(walk).join('');
    }
    const text = walk(doc).replace(/\s+/g, ' ').trim();
    if (maxLen && text.length > maxLen) return text.slice(0, maxLen).trim() + '…';
    return text;
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (e) {
      return '';
    }
  }

  function normalizeEntry(item) {
    const f = item.fields || {};
    const title = f.title || 'Untitled';
    const description = f.description || plainTextFromRichText(f.content, 160);
    const category = f.category || 'Blog';
    const slug = f.slug || item.sys.id;
    return {
      id: item.sys.id,
      title: title,
      description: description,
      category: category,
      slug: slug,
      date: formatDate(item.sys.createdAt),
      createdAt: item.sys.createdAt,
      contentHtml: richTextToHtml(f.content),
      url: 'post.html?id=' + encodeURIComponent(item.sys.id)
    };
  }

  function fetchPosts(limit) {
    const client = getClient();
    const query = {
      content_type: CONTENT_TYPE,
      order: '-sys.createdAt',
      limit: limit || 20
    };
    return client.getEntries(query).then(function (res) {
      return (res.items || []).map(normalizeEntry);
    });
  }

  function fetchPostById(id) {
    const client = getClient();
    return client.getEntry(id).then(normalizeEntry);
  }

  global.BikashBlog = {
    fetchPosts: fetchPosts,
    fetchPostById: fetchPostById,
    richTextToHtml: richTextToHtml
  };
})(window);
