(function () {
  'use strict';

  function sendHeight() {
    try {
      const height =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      window.parent.postMessage(
        {
          type: 'resize',
          height: height,
          url: window.location.href,
        },
        '*'
      );
    } catch (error) {
      console.error('Failed to send height to parent page:', error);
    }
  }

  const POST_MESSAGE_EVENT_TYPE = {
    SlideElementClicked: 'SLIDE_ELEMENT_CLICKED',
    SlideSaveImageClicked: 'SLIDE_SAVE_IMAGE_CLICKED',
    SlideCancelImageClicked: 'SLIDE_CANCEL_IMAGE_CLICKED',
    SlideCancelEdit: 'SLIDE_CANCEL_EDIT',
    SlideUpdateHtml: 'SLIDE_UPDATE_HTML',
    SlideEditMode: 'SLIDE_EDIT_MODE',
    SlideSaveTextContent: 'SLIDE_SAVE_TEXT_CONTENT',
    SlideSaveTextStyle: 'SLIDE_SAVE_TEXT_STYLE',
    SlideRefreshIframe: 'SLIDE_REFRESH_IFRAME',
    SlideCancelHoverEdit: 'SLIDE_CANCEL_HOVER_EDIT',
    CanvasEffectsUploadFile: 'CANVAS_EFFECTS.UPLOAD_FILE',
    SlideNext: 'SLIDE_NEXT',
    SlidePrev: 'SLIDE_PREV',
    SlideAddPopover: 'SLIDE_ADD_POPOVER',
    SlideDeleteElement: 'SLIDE_DELETE_ELEMENT',
    SlideModifytImgStyle: 'SLIDE_MODIFY_IMG_STYLE',
    SlideModifyPosition: 'SLIDE_MODIFY_POSITION',
    SlideDuplicateElement: 'SLIDE_DUPLICATE_ELEMENT',
    SlideUndo: 'SLIDE_UNDO',
    SlideSyncSelectStyle: 'SLIDE_SYNC_SELECT_STYLE',
    SlideRedo: 'SLIDE_REDO',
    SlideUpdateUndoAndRedoStackLength: 'SLIDE_UPDATE_UNDO_AND_REDO_STACK_LENGTH',
    SlideDeleteElementUpdateHeight: 'SLIDE_DELETE_ELEMENT_UPDATE_HEIGHT',

    ChromeExtensionUpdateUserInfo: 'chrome_extension_update_user_info',
    ChromeExtensionRequestPageAnalysis: 'chrome_extension_request_page_analysis',
    ChromeExtensionIndexInitSuccess: 'chrome_extension_index_init_success',
    ChromeExtensionQuotaExceed: 'chrome_extension_quota_exceed',
    ChromeExtensionCopyContent: 'chrome_extension_copy_content',

    ChromeExtensionGetImageStudioUrl: 'chrome_extension_get_image_studio_url',
    ChromeExtensionPostImageStudioUrl: 'chrome_extension_post_image_studio_url',
    ChromeExtensionGetImageUrl: 'chrome_extension_get_image_url',
    ChromeExtensionPostImageUrl: 'chrome_extension_post_image_url',

    ChromeExtensionPostLongPrompt: 'chrome_extension_post_long_prompt',
    ChromeExtensionGetLongPrompt: 'chrome_extension_get_long_prompt',

    ChromeExtensionDownloadToAIDriveGetUrl:
      'chrome_extension_download_to_ai_drive_get_url',
    ChromeExtensionDownloadToAIDrivePostUrl:
      'chrome_extension_download_to_ai_drive_post_url',
  };

  const EDIT_SLIDE_CONSTANT = {
    PostMessageOrigin: '*',
    ParentOriginList: [
      'http://localhost:3000',
      'https://www.coswift.ai',
      'https://www.genspark.ai',
      'https://*.i.coswift.ai',
      'https://*.genspark.space',
      'https://*.gensparkspace.com',
      'https://page.genspark.site',
      'https://page1.genspark.site',
    ],
    CurEleId: 'slide-edit-cur-ele-id',
    CurClickEleId: 'slide-edit-cur-click-ele-id',
    StyleId: 'slide-selected-style',
    GsSlidePopover: 'gs-slide-popover',
  };

  const EDIT_SLIDE_SELECTED_ATTR = {
    TextAndImg: 'data-slide-selected',
    ContainerClickSelected: 'item-slide-click-selected',
    ContainerSelected: 'item-slide-selected',
  };

  function postMessageToParent(data) {
    window.parent.postMessage(data, '*');
  }

  function getUniqueSelector(target) {
    if (!(target instanceof Element)) return null

    // Create description of the target element
    let elementInfo = getElementDescription(target);

    // Get path to the element
    const pathParts = [];
    let el = target.parentNode;
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      const parent = el.parentNode;
      if (!parent) break

      const part = getPathPart(el);
      pathParts.unshift(part);
      el = parent;
    }

    const pathString = pathParts.length > 0 ? pathParts.join(' → ') : 'document';

    // Return structured information
    return {
      element: elementInfo,
      path: pathString,
      pathParts: pathParts,
      description: `Element: ${elementInfo.description}\nPath: ${pathString}`,
    }

    // Helper function to get element description
    function getElementDescription(element) {
      const tag = element.tagName.toLowerCase();
      const elementInfo = {
        tagName: tag,
        id: element.id || null,
        classes: element.classList ? Array.from(element.classList) : [],
        textContent: null,
        attributes: {},
        selector: tag,
        description: tag,
      };

      // Build selector
      if (element.id) {
        elementInfo.selector += `#${element.id}`;
        elementInfo.description += `#${element.id}`;
      }

      if (elementInfo.classes.length > 0) {
        const classStr = elementInfo.classes.join('.');
        elementInfo.selector += `.${classStr}`;
        elementInfo.description += `.${classStr}`;
      }

      // Get text content
      const textContent = element.textContent?.trim();
      if (textContent && textContent.length > 0) {
        // Replace multiple consecutive spaces with single space
        const normalizedText = textContent.replace(/\s+/g, ' ');
        elementInfo.textContent = normalizedText;
        elementInfo.description += ` content: "${normalizedText.replace(/"/g, '\\"')}"`;
      }

      // Handle specific element types
      if (tag === 'img') {
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt');
        elementInfo.attributes.src = src;
        elementInfo.attributes.alt = alt;
        elementInfo.description += ` image${alt ? `: "${alt}"` : ''}`;
        if (src) {
          const srcShort =
            src.length > 20 ? src.substring(src.lastIndexOf('/') + 1) : src;
          elementInfo.description += ` (${srcShort})`;
        }
      }

      if (tag === 'input') {
        const type = element.type || 'text';
        const value = element.value;
        elementInfo.attributes.type = type;
        elementInfo.attributes.value = value;
        elementInfo.description += ` ${type} input${value ? ` value: "${value}"` : ''}`;
      }

      // Add other common attributes
      const commonAttributes = ['href', 'title', 'data-id', 'role', 'aria-label'];
      commonAttributes.forEach(attr => {
        const value = element.getAttribute(attr);
        if (value) {
          elementInfo.attributes[attr] = value;
        }
      });

      return elementInfo
    }

    // Helper function to get path part
    function getPathPart(element) {
      const tag = element.tagName.toLowerCase();
      let part = tag;

      // Add ID if available
      if (element.id) {
        part += `#${element.id}`;
      }

      // Add classes if available
      if (element.classList && element.classList.length > 0) {
        const classStr = Array.from(element.classList).join('.');
        part += `.${classStr}`;
      }

      // Add position info
      const siblings = Array.from(element.parentNode.children);
      const sameTagSiblings = siblings.filter(s => s.tagName === element.tagName);

      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(element) + 1;
        part += ` (${index}th ${tag})`;
      }

      return part
    }
  }

  function isOriginAllowed(origin) {
    // 直接匹配
    if (EDIT_SLIDE_CONSTANT.ParentOriginList.includes(origin)) {
      return true
    }

    // 通配符匹配
    for (const pattern of EDIT_SLIDE_CONSTANT.ParentOriginList) {
      if (pattern.includes('*')) {
        const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(origin)) {
          return true
        }
      }
    }

    return false
  }

  function slideUpdateHtml() {
    let content = document.documentElement.outerHTML;
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const dom = doc.getElementById(EDIT_SLIDE_CONSTANT.CurEleId);
    if (dom) {
      dom.removeAttribute('data-slide-selected');
      dom.removeAttribute('id');
      dom.removeAttribute('item-slide-selected');
    }
    const domClick = doc.getElementById(EDIT_SLIDE_CONSTANT.CurClickEleId);
    if (domClick) {
      domClick.removeAttribute('data-slide-selected');
      domClick.removeAttribute('id');
      domClick.removeAttribute('item-slide-selected');
    }
    const domStyle = doc.getElementById(EDIT_SLIDE_CONSTANT.StyleId);
    if (domStyle) {
      domStyle.parentNode.removeChild(domStyle);
    }
    const gensparkBadgeStyle = doc.getElementById('genspark-badge');
    if (gensparkBadgeStyle) {
      gensparkBadgeStyle.parentNode.removeChild(gensparkBadgeStyle);
    }
    const gensparkCaptureScript = doc.getElementById('genspark-capture-script');
    if (gensparkCaptureScript) {
      gensparkCaptureScript.parentNode.removeChild(gensparkCaptureScript);
    }
    doc.querySelectorAll('[data-slide-selected]').forEach(item => {
      item.removeAttribute('data-slide-selected');
    });
    doc.querySelectorAll('[item-slide-click-selected]').forEach(item => {
      item.removeAttribute('item-slide-click-selected');
    });
    doc.querySelectorAll('[item-slide-selected]').forEach(item => {
      item.removeAttribute('item-slide-selected');
    });
    doc.querySelectorAll('[data-slide-hover-selected]').forEach(item => {
      item.removeAttribute('data-slide-hover-selected');
    });
    content = doc.documentElement.outerHTML;
    postMessageToParent({
      type: POST_MESSAGE_EVENT_TYPE.SlideUpdateHtml,
      payload: {
        iframeId: window.location.href,
        content: content,
      },
    });
  }

  function getTranslateXY(element) {
    const style = window.getComputedStyle(element);
    const transform =
      style.transform || style.webkitTransform || style.mozTransform;

    let translateX = 0;
    let translateY = 0;

    if (transform && transform !== 'none') {
      if (transform.startsWith('matrix3d')) {
        // 3D matrix
        const values = transform
          .match(/^matrix3d\((.+)\)$/)[1]
          .split(', ')
          .map(parseFloat);
        translateX = values[12]; // 13th value
        translateY = values[13]; // 14th value
      } else if (transform.startsWith('matrix')) {
        // 2D matrix
        const values = transform
          .match(/^matrix\((.+)\)$/)[1]
          .split(', ')
          .map(parseFloat);
        translateX = values[4]; // 5th value
        translateY = values[5]; // 6th value
      }
    }

    return { x: translateX, y: translateY }
  }

  function getHeight() {
    return document.documentElement.scrollHeight || document.body.scrollHeight
  }

  let isCanEditSlide = false;
  const undoStack = window.slideUndoStack || [];
  const redoStack = window.slideRedoStack || [];

  function slideSelectedStyle() {
    const style = document.createElement('style');
    style.setAttribute('id', EDIT_SLIDE_CONSTANT.StyleId);
    style.textContent = `
  [data-slide-selected]::before
  /* [data-slide-hover-selected]::before */ {
    content: '';
    position: absolute;
    top: -4px;
    left: -4px;
    width: 100%;
    height: 100%;
    box-sizing: content-box;
    padding: 4px;
    border-radius: 0px;
    outline: 2px solid #0f7fff !important;
    z-index: 10000;
    pointer-events: none;
  }

 /* [data-slide-hover-selected], */
  [data-slide-selected] {
    position: relative;
    outline: none;
    cursor: default;
  }

  img[data-slide-selected],
  img[data-slide-hover-selected],
  [data-slide-hover-selected],
  [item-slide-click-selected],
  [item-slide-selected] {
    border: 2px solid #0f7fff !important;
  }


`;
    document.head.appendChild(style);
  }

  async function handlerImgEdit(target) {
    target.setAttribute(EDIT_SLIDE_SELECTED_ATTR.TextAndImg, true);
    target.setAttribute('id', EDIT_SLIDE_CONSTANT.CurClickEleId);

    // Send message containing domPath and other information
    postMessageToParent({
      type: POST_MESSAGE_EVENT_TYPE.SlideElementClicked,
      payload: {
        id: EDIT_SLIDE_CONSTANT.CurClickEleId,
        iframeId: window.location.href,
        elementType: 'img',
        domPath: getUniqueSelector(target),
        attrs: {
          src: target.getAttribute('src'),
        },
      },
    });

    // Generate base64 for gk_dogfood users
    try {
      await captureElementToBase64(target, 'img', {
        id: EDIT_SLIDE_CONSTANT.CurClickEleId,
        domPath: getUniqueSelector(target),
        attrs: {
          src: target.getAttribute('src'),
        },
      });
    } catch (error) {
      console.error('Failed to capture image element:', error);
      // Continue with the flow even if screenshot fails
    }

    addPopover('img');
  }

  function removeTextAttribute(target) {
    target.removeAttribute('data-slide-selected');
    target.removeAttribute('id');
    target.removeAttribute('item-slide-selected');
  }

  function removeImgAttribute(target) {
    target.removeAttribute('data-slide-selected');
    target.removeAttribute('id');
    target.removeAttribute('item-slide-selected');
  }

  function removeItemAttribute() {
    document.querySelectorAll('[item-slide-selected]').forEach(item => {
      item.removeAttribute('item-slide-selected');
    });
  }

  function removeItemClickAttribute() {
    document.querySelectorAll('[item-slide-click-selected]').forEach(item => {
      item.removeAttribute('item-slide-click-selected');
    });
  }

  function removeNoCurClickEleAttributes() {
    document.querySelectorAll('[data-slide-hover-selected]').forEach(item => {
      item.removeAttribute('data-slide-hover-selected');
    });
    removeItemAttribute();
  }

  function removeHoverSelectedEleAttributes() {
    document.querySelectorAll('[data-slide-hover-selected]').forEach(item => {
      item.removeAttribute('data-slide-hover-selected');
    });
    removeItemAttribute();
  }

  function removeSelectedEleAttributes() {
    removeHoverSelectedEleAttributes();
    const domClick = document.getElementById(EDIT_SLIDE_CONSTANT.CurClickEleId);
    if (domClick) {
      removeTextAttribute(domClick);
      removeImgAttribute(domClick);
    }
    document.querySelectorAll('[data-slide-selected]').forEach(item => {
      item.removeAttribute('data-slide-selected');
    });
    document.querySelectorAll('[data-slide-hover-selected]').forEach(item => {
      item.removeAttribute('data-slide-hover-selected');
    });
    removeItemAttribute();
    removeItemClickAttribute();
  }

  function addElementSelectedMouseover(target) {
    target.setAttribute('data-slide-hover-selected', true);
  }

  function handlerTextMouseover(target) {
    target.setAttribute('data-slide-hover-selected', true);
  }

  function handlerImgMouseover(target) {
    target.setAttribute('data-slide-hover-selected', true);
  }

  // Helper function to check if an image can be loaded
  function checkImageAvailability(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;

      // Set a timeout to avoid hanging
      setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve(false);
      }, 3000);
    })
  }

  // Helper function to pre-process images and replace broken ones
  async function preprocessImages(container) {
    const images = container.querySelectorAll('img');
    const imagePromises = [];

    images.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:')) {
        imagePromises.push(
          checkImageAvailability(src)
            .then(isAvailable => {
              if (!isAvailable) {
                // Store original src for potential recovery
                img.setAttribute('data-original-src', src);

                // Replace broken image with a placeholder
                img.style.backgroundColor = '#f0f0f0';
                img.style.border = '2px dashed #ccc';
                img.style.display = 'flex';
                img.style.alignItems = 'center';
                img.style.justifyContent = 'center';
                img.style.color = '#666';
                img.style.fontSize = '12px';
                img.style.textAlign = 'center';
                img.style.minWidth = '100px';
                img.style.minHeight = '60px';
                img.removeAttribute('src');
                img.alt = 'Image not available';

                // Set innerHTML to show broken image message
                img.innerHTML = '🚫 Image not available';
              }
            })
            .catch(error => {
              console.warn('Error processing image:', src, error);
              // Even if checking fails, try to set a placeholder
              img.style.backgroundColor = '#f0f0f0';
              img.style.border = '2px dashed #ccc';
              img.removeAttribute('src');
              img.alt = 'Image error';
            })
        );
      }
    });

    try {
      await Promise.allSettled(imagePromises);
    } catch (error) {
      console.warn('Error in preprocessImages:', error);
    }
  }

  async function captureElementToBase64(
    domElement,
    elementType = 'container',
    additionalPayload = {}
  ) {
    // Check input parameters
    if (!domElement || !(domElement instanceof Element)) {
      console.error('Please provide a valid DOM element');
      return
    }

    let elementsToClean = [];
    let originalAttributes = [];

    try {
      // Load snapdom library if not already loaded
      if (typeof window.snapdom === 'undefined') {
        await loadSnapdomLibrary();
      }

      // Temporarily remove selection attributes to avoid capturing them
      elementsToClean = [
        ...document.querySelectorAll('[item-slide-click-selected]'),
        ...document.querySelectorAll('[item-slide-selected]'),
        ...document.querySelectorAll('[data-slide-selected]'),
        ...document.querySelectorAll('[data-slide-hover-selected]'),
      ];

      originalAttributes = [];
      elementsToClean.forEach((element, index) => {
        originalAttributes[index] = {};
        if (element.hasAttribute('item-slide-click-selected')) {
          originalAttributes[index]['item-slide-click-selected'] =
            element.getAttribute('item-slide-click-selected');
          element.removeAttribute('item-slide-click-selected');
        }
        if (element.hasAttribute('item-slide-selected')) {
          originalAttributes[index]['item-slide-selected'] = element.getAttribute(
            'item-slide-selected'
          );
          element.removeAttribute('item-slide-selected');
        }
        if (element.hasAttribute('data-slide-selected')) {
          originalAttributes[index]['data-slide-selected'] = element.getAttribute(
            'data-slide-selected'
          );
          element.removeAttribute('data-slide-selected');
        }
        if (element.hasAttribute('data-slide-hover-selected')) {
          originalAttributes[index]['data-slide-hover-selected'] =
            element.getAttribute('data-slide-hover-selected');
          element.removeAttribute('data-slide-hover-selected');
        }
      });

      // Pre-process images to handle broken links
      await preprocessImages(document.body);

      // Get element dimensions and scroll position
      const rect = domElement.getBoundingClientRect();
      const scrollLeft = Math.max(
        document.documentElement.scrollLeft,
        document.body.scrollLeft
      );
      const scrollTop = Math.max(
        document.documentElement.scrollTop,
        document.body.scrollTop
      );

      // Calculate absolute position of element relative to document
      const elementLeft = rect.left + scrollLeft;
      const elementTop = rect.top + scrollTop;

      const padding = 4;
      const pageWidth = document.documentElement.scrollWidth;
      const pageHeight = document.documentElement.scrollHeight;

      // Calculate padding with boundary checks
      const leftPadding = Math.min(padding, elementLeft);
      const topPadding = Math.min(padding, elementTop);
      const rightPadding = Math.min(
        padding,
        pageWidth - (elementLeft + rect.width)
      );
      const bottomPadding = Math.min(
        padding,
        pageHeight - (elementTop + rect.height)
      );

      // Calculate crop area with padding
      const cropLeft = elementLeft - leftPadding;
      const cropTop = elementTop - topPadding;
      const cropWidth = rect.width + leftPadding + rightPadding;
      const cropHeight = rect.height + topPadding + bottomPadding;

      // Capture the entire page first with timeout
      const devicePixelRatio = window.devicePixelRatio || 1;

      const capturePromise = window.snapdom.toCanvas(document.body, {
        scale: devicePixelRatio,
        compress: true,
        fast: true,
        embedFonts: false,
        backgroundColor: '#ffffff',
        timeout: 10000, // 10 second timeout
        allowTaint: true, // Allow tainted canvas for cross-origin images
        useCORS: true, // Enable CORS for cross-origin images
        crossOrigin: url => {
          try {
            // Use credentials for same-origin images
            if (url.startsWith(window.location.origin)) {
              return 'use-credentials'
            }
            // Use anonymous for cross-origin images
            return 'anonymous'
          } catch (e) {
            console.warn('Error handling crossOrigin for URL:', url, e);
            return 'anonymous'
          }
        },
        onError: (error, element) => {
          console.warn(
            'snapdom encountered an error:',
            error,
            'Element:',
            element
          );
          // Continue with the capture even if some resources fail
          return true
        },
        onResourceError: (error, url) => {
          console.warn('snapdom resource error:', error, 'URL:', url);
          // Continue with the capture even if some resources fail
          return true
        },
        onProgress: progress => {
          // Optional: track progress for very large captures
          if (progress.total > 0) {
          }
        },
      });

      // Add a timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot timeout')), 15000);
      });

      const fullPageCanvas = await Promise.race([capturePromise, timeoutPromise]);

      // Calculate actual scale factors based on the created canvas
      const actualCanvasWidth = fullPageCanvas.width / devicePixelRatio;
      const actualCanvasHeight = fullPageCanvas.height / devicePixelRatio;
      const scaleX = actualCanvasWidth / pageWidth;
      const scaleY = actualCanvasHeight / pageHeight;

      // Recalculate crop coordinates based on actual canvas scale
      const scaledCropLeft = cropLeft * scaleX;
      const scaledCropTop = cropTop * scaleY;
      const scaledCropWidth = cropWidth * scaleX;
      const scaledCropHeight = cropHeight * scaleY;

      // Create a new canvas for the cropped region
      const croppedCanvas = document.createElement('canvas');
      const croppedWidth = Math.max(1, (scaledCropWidth * devicePixelRatio) / 2);
      const croppedHeight = Math.max(1, (scaledCropHeight * devicePixelRatio) / 2);

      croppedCanvas.width = croppedWidth;
      croppedCanvas.height = croppedHeight;

      const croppedCtx = croppedCanvas.getContext('2d');

      // Draw the cropped region from the full page canvas
      croppedCtx.drawImage(
        fullPageCanvas,
        scaledCropLeft * devicePixelRatio, // Source X
        scaledCropTop * devicePixelRatio, // Source Y
        scaledCropWidth * devicePixelRatio, // Source width
        scaledCropHeight * devicePixelRatio, // Source height
        0, // Destination X
        0, // Destination Y
        croppedWidth, // Destination width (now half size)
        croppedHeight // Destination height (now half size)
      );

      // Convert to base64
      const base64Image = croppedCanvas.toDataURL('image/jpeg', 0.7);

      // Send message to parent with base64
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlideElementClicked,
        payload: {
          iframeId: window.location.href,
          elementType: elementType,
          base64: base64Image,
          screenshotSuccess: true,
          ...additionalPayload,
        },
      });
    } catch (err) {
      console.error('Error during screenshot process with snapdom:', err);

      // Send message to parent without base64 but with error information
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlideElementClicked,
        payload: {
          iframeId: window.location.href,
          elementType: elementType,
          screenshotSuccess: false,
          screenshotError: err.message,
          ...additionalPayload,
        },
      });
    } finally {
      // Always restore attributes, even if an error occurred
      try {
        elementsToClean.forEach((element, index) => {
          if (originalAttributes[index]) {
            Object.keys(originalAttributes[index]).forEach(attr => {
              element.setAttribute(attr, originalAttributes[index][attr]);
            });
          }
        });
      } catch (restoreError) {
        console.error('Error restoring attributes:', restoreError);
      }
    }
  }

  // Helper function to load snapdom library
  function loadSnapdomLibrary() {
    return new Promise((resolve, reject) => {
      if (typeof window.snapdom !== 'undefined') {
        resolve();
        return
      }

      // Check if we're already loading the library
      if (document.getElementById('genspark-capture-script')) {
        // Wait for existing script to load
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (typeof window.snapdom !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (attempts > 20) {
            // Wait up to 2 seconds
            clearInterval(checkInterval);
            reject(new Error('snapdom library loading timeout'));
          }
        }, 100);
        return
      }

      const script = document.createElement('script');
      script.id = 'genspark-capture-script';
      script.src =
        'https://cdn.jsdelivr.net/npm/@zumer/snapdom/dist/snapdom.min.js';

      // Set a timeout for loading
      const timeout = setTimeout(() => {
        script.onload = null;
        script.onerror = null;
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error('snapdom library loading timeout'));
      }, 10000); // 10 second timeout

      script.onload = function () {
        clearTimeout(timeout);
        if (typeof window.snapdom !== 'undefined') {
          resolve();
        } else {
          reject(new Error('snapdom library failed to load properly'));
        }
      };

      script.onerror = function () {
        clearTimeout(timeout);
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error('Unable to load snapdom library'));
      };

      document.head.appendChild(script);
    })
  }

  async function addElementSelectedClick(target) {
    target.setAttribute('item-slide-click-selected', true);
    postMessageToParent({
      type: POST_MESSAGE_EVENT_TYPE.SlideElementClicked,
      payload: {
        iframeId: window.location.href,
        elementType: 'container',
        domPath: getUniqueSelector(target),
      },
    });

    try {
      await captureElementToBase64(target, 'container', {
        domPath: getUniqueSelector(target),
      });
    } catch (error) {
      console.error('Failed to capture container element:', error);
      // Continue with the flow even if screenshot fails
    }

    addPopover('container');
  }

  async function addPopover(elementType) {
    // Get target element
    let target = document.querySelector('[data-slide-selected]');
    if (elementType === 'container') {
      target = document.querySelector('[item-slide-click-selected]');
    }
    if (!target) return

    // Calculate position
    const rect = target.getBoundingClientRect();
    const scrollLeft = Math.max(
      document.documentElement.scrollLeft,
      document.body.scrollLeft
    );
    const scrollTop = Math.max(
      document.documentElement.scrollTop,
      document.body.scrollTop
    );

    const style = getComputedStyle(target);
    const { x, y } = getTranslateXY(target);

    postMessageToParent({
      type: POST_MESSAGE_EVENT_TYPE.SlideAddPopover,
      payload: {
        iframeId: window.location.href,
        elementType: elementType,
        attrs: {
          style: {
            left: rect.left + scrollLeft,
            top: rect.top + scrollTop,
            width: rect.width,
            height: rect.height,
            objectFit: style.objectFit,
            transformX: x,
            transformY: y,
          },
        },
      },
    });
  }

  async function handlerTextClickEdit(target) {
    const hasTextNode = Array.from(target.childNodes).some(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (!hasTextNode) {
      await addElementSelectedClick(target);
      return
    }
    target.setAttribute(EDIT_SLIDE_SELECTED_ATTR.TextAndImg, true);

    // Send message containing domPath and other information
    syncSelectStyle(POST_MESSAGE_EVENT_TYPE.SlideElementClicked, 'text');

    // Generate base64 for gk_dogfood users
    try {
      const style = getComputedStyle(target);
      const rect = target.getBoundingClientRect();
      const { x, y } = getTranslateXY(target);

      await captureElementToBase64(target, 'text', {
        id: EDIT_SLIDE_CONSTANT.CurClickEleId,
        domPath: getUniqueSelector(target),
        attrs: {
          text: target.textContent,
          style: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            textDecoration: style.textDecorationLine,
            fontStyle: style.fontStyle,
            color: style.color,
            textAlign: style.textAlign,
            fontColor: style.color,
            transformX: x,
            transformY: y,
            objectFit: style.objectFit,
          },
        },
      });
    } catch (error) {
      console.error('Failed to capture text element:', error);
      // Continue with the flow even if screenshot fails
    }

    addPopover('text');
  }

  function hanlderElementMouseover(event) {
    if (!isCanEditSlide) {
      return
    }

    const target = event.target;
    removeNoCurClickEleAttributes();

    if (target.textContent && target.textContent.trim().length > 0) {
      handlerTextMouseover(target);
    } else if (target.tagName === 'IMG') {
      handlerImgMouseover(target);
    } else if (target) {
      addElementSelectedMouseover(target);
    }
  }

  async function hanlderElementClick(event) {
    if (!isCanEditSlide) {
      return
    }
    const target = event.target;
    removeSelectedEleAttributes();

    if (target.textContent && target.textContent.trim().length > 0) {
      await handlerTextClickEdit(target);
    } else if (target.tagName === 'IMG') {
      await handlerImgEdit(target);
    } else if (target) {
      await addElementSelectedClick(target);
    }
  }

  function hanlderMessage(event) {
    if (!isOriginAllowed(event.origin)) {
      return
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideEditMode) {
      isCanEditSlide = event.data.payload.isCanEditSlide;
      if (!isCanEditSlide) {
        removeSelectedEleAttributes();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideSaveTextContent) {
      let dom = document.querySelector('[data-slide-selected]');
      if (dom) {
        dom.textContent = event.data.payload.attrs.text;
        slideUpdateHtml();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideSaveImageClicked) {
      let img = document.getElementById(EDIT_SLIDE_CONSTANT.CurClickEleId);
      if (img) {
        addUndoStack();
        img.setAttribute('src', event.data.payload.attrs.src);
        slideUpdateHtml();
      }
    }
    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideCancelImageClicked) {
      document.getElementById(EDIT_SLIDE_CONSTANT.CurClickEleId);
      removeSelectedEleAttributes();
    }
    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideCancelEdit) {
      document.querySelectorAll('[data-slide-selected]').forEach(item => {
        item.removeAttribute('data-slide-selected');
      });
      document.querySelectorAll('[data-slide-hover-selected]').forEach(item => {
        item.removeAttribute('data-slide-hover-selected');
      });
      document.getElementById(EDIT_SLIDE_CONSTANT.CurClickEleId);
      removeSelectedEleAttributes();
    }
    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideCancelHoverEdit) {
      removeHoverSelectedEleAttributes();
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideSaveTextStyle) {
      const dom = document.querySelector('[data-slide-selected]');
      if (dom) {
        addUndoStack();
        if (event.data.payload.attrs.style.fontFamily) {
          dom.style.fontFamily = event.data.payload.attrs.style.fontFamily;
        }
        if (event.data.payload.attrs.style.fontSize) {
          dom.style.fontSize = event.data.payload.attrs.style.fontSize;
        }
        if (event.data.payload.attrs.style.fontWeight) {
          dom.style.fontWeight = event.data.payload.attrs.style.fontWeight;
        }
        if (event.data.payload.attrs.style.textDecoration) {
          dom.style.textDecoration = event.data.payload.attrs.style.textDecoration;
        }
        if (event.data.payload.attrs.style.fontStyle) {
          dom.style.fontStyle = event.data.payload.attrs.style.fontStyle;
        }
        if (event.data.payload.attrs.style.color) {
          dom.style.color = event.data.payload.attrs.style.color;
        }
        if (event.data.payload.attrs.style.textAlign) {
          dom.style.textAlign = event.data.payload.attrs.style.textAlign;
        }
        slideUpdateHtml();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideDeleteElement) {
      let target = null;
      if (event.data.payload.elementType !== 'container') {
        target = document.querySelector('[data-slide-selected]');
      } else {
        target = document.querySelector('[item-slide-click-selected]');
      }
      if (target) {
        addUndoStack();
        target.parentNode.removeChild(target);
        slideUpdateHtml();
        postMessageToParent({
          type: POST_MESSAGE_EVENT_TYPE.SlideDeleteElementUpdateHeight,
          payload: {
            iframeId: window.location.href,
            height: getHeight(),
          },
        });
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideModifytImgStyle) {
      const target = document.querySelector('[data-slide-selected]');
      if (target) {
        addUndoStack();
        target.style.objectFit = event.data.payload.attrs.style.objectFit;
        if (event.data.payload.attrs.style.height) {
          target.style.height = event.data.payload.attrs.style.height;
        }
        if (event.data.payload.attrs.style.width) {
          target.style.width = event.data.payload.attrs.style.width;
        }
        slideUpdateHtml();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideModifyPosition) {
      isCanEditSlide = false;
      const target = document.querySelector('[data-slide-selected]');
      if (target) {
        target.style.transform = `translate(${event.data.payload.attrs.style.transformX}px, ${event.data.payload.attrs.style.transformY}px)`;
        target.style.width = event.data.payload.attrs.style.width;
        target.style.height = event.data.payload.attrs.style.height;

        slideUpdateHtml();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideDuplicateElement) {
      let target = document.querySelector('[data-slide-selected]');
      if (!target) {
        target = document.querySelector('[item-slide-click-selected]');
      }

      if (target) {
        addUndoStack();
        const newElement = target.cloneNode(true);
        newElement.removeAttribute('data-slide-selected');
        newElement.removeAttribute('item-slide-click-selected');
        target.parentNode.insertBefore(newElement, target.nextSibling);
        slideUpdateHtml();
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideUndo) {
      popUndoStack();
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideRedo) {
      popRedoStack();
    }

    // Handle messages for parent page calling child page functions
    if (event.data.type === 'PARENT_CALL_FUNCTION') {
      const { functionName, args = [], callbackId } = event.data.payload || {};

      // List of functions that can be called by parent page
      const exposedFunctions = {
        getHeight,
        // Can continue to add other functions to expose to parent page
      };

      if (exposedFunctions[functionName]) {
        try {
          // Execute the called function
          const result = exposedFunctions[functionName](...args);

          // Return execution result to parent page
          if (callbackId) {
            postMessageToParent({
              type: 'PARENT_CALL_FUNCTION_RESPONSE',
              payload: {
                callbackId,
                success: true,
                result,
              },
            });
          }
        } catch (error) {
          console.error(`Error executing function ${functionName}:`, error);

          // Return error information to parent page
          if (callbackId) {
            postMessageToParent({
              type: 'PARENT_CALL_FUNCTION_RESPONSE',
              payload: {
                callbackId,
                success: false,
                error: error.message,
              },
            });
          }
        }
      }
    }

    if (event.data.type === POST_MESSAGE_EVENT_TYPE.SlideRefreshIframe) {
      window.location.reload();
    }
  }

  function syncSelectStyle(type, elementType) {
    const target = document.querySelector('[data-slide-selected]');
    const style = getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    const { x, y } = getTranslateXY(target);
    postMessageToParent({
      type: type,
      payload: {
        id: EDIT_SLIDE_CONSTANT.CurClickEleId,
        iframeId: window.location.href,
        elementType: elementType,
        domPath: getUniqueSelector(target),
        attrs: {
          text: target.textContent,
          style: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            textDecoration: style.textDecorationLine,
            fontStyle: style.fontStyle,
            color: style.color,
            textAlign: style.textAlign,
            fontColor: style.color,
            transformX: x,
            transformY: y,
            objectFit: style.objectFit,
          },
        },
      },
    });
  }

  function slideUpdateUndoAndRedoStackLength() {
    postMessageToParent({
      type: POST_MESSAGE_EVENT_TYPE.SlideUpdateUndoAndRedoStackLength,
      payload: {
        iframeId: window.location.href,
        undoStackLength: undoStack.length,
        redoStackLength: redoStack.length,
      },
    });
  }

  function popUndoStack() {
    if (undoStack.length > 0) {
      const currentHtml = document.body.innerHTML;
      const lastHtml = undoStack.pop();
      document.body.innerHTML = lastHtml;
      window.slideUndoStack = undoStack || [];
      // Save current state to redo stack
      redoStack.push(currentHtml);
      window.slideRedoStack = redoStack || [];
      slideUpdateHtml();
      slideUpdateUndoAndRedoStackLength();
    }
  }

  function popRedoStack() {
    if (redoStack.length > 0) {
      const currentHtml = document.body.innerHTML;
      const lastHtml = redoStack.pop();
      document.body.innerHTML = lastHtml;
      window.slideRedoStack = redoStack || [];
      // Save current state to undo stack
      undoStack.push(currentHtml);
      window.slideUndoStack = undoStack || [];
      slideUpdateHtml();
      slideUpdateUndoAndRedoStackLength();
    }
  }

  function addUndoStack() {
    let html = document.body.outerHTML;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('[data-slide-selected]').forEach(item => {
      item.removeAttribute(EDIT_SLIDE_SELECTED_ATTR.TextAndImg);
    });
    doc.querySelectorAll('[item-slide-click-selected]').forEach(item => {
      item.removeAttribute(EDIT_SLIDE_SELECTED_ATTR.ContainerClickSelected);
    });
    doc.querySelectorAll('[item-slide-selected]').forEach(item => {
      item.removeAttribute(EDIT_SLIDE_SELECTED_ATTR.ContainerSelected);
    });
    html = doc.body.innerHTML;
    undoStack.push(html);
    window.slideUndoStack = undoStack || [];
    // Clear redo stack when new changes are made
    redoStack.length = 0;
    window.slideRedoStack = redoStack || [];

    slideUpdateUndoAndRedoStackLength();
  }

  function slideEidtPostMessage() {
    document.addEventListener('mouseover', hanlderElementMouseover);
    document.addEventListener('click', hanlderElementClick);
    window.addEventListener('message', hanlderMessage);
  }

  // Helper function to restore original image sources
  function restoreOriginalImages() {
    const images = document.querySelectorAll('img[data-original-src]');
    images.forEach(img => {
      const originalSrc = img.getAttribute('data-original-src');
      if (originalSrc) {
        checkImageAvailability(originalSrc)
          .then(isAvailable => {
            if (isAvailable) {
              img.setAttribute('src', originalSrc);
              img.removeAttribute('data-original-src');
              img.style.backgroundColor = '';
              img.style.border = '';
              img.style.display = '';
              img.style.alignItems = '';
              img.style.justifyContent = '';
              img.style.color = '';
              img.style.fontSize = '';
              img.style.textAlign = '';
              img.style.minWidth = '';
              img.style.minHeight = '';
              img.innerHTML = '';
            }
          })
          .catch(error => {
            console.warn('Error restoring image:', originalSrc, error);
          });
      }
    });
  }

  function slideSelectedEdit() {
    slideSelectedStyle();
    slideEidtPostMessage();

    // Try to restore original images periodically
    setInterval(restoreOriginalImages, 30000); // Check every 30 seconds
  }

  function hanlderWheel(event) {
    if (event.deltaY > 20) {
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlideNext
      });
    }
    if (event.deltaY < -20) {
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlidePrev
      });
    }
  }

  function hanlderKeyDown(event) {
    if (event.key === 'ArrowRight') {
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlideNext
      });
    }
    if (event.key === 'ArrowLeft') {
      postMessageToParent({
        type: POST_MESSAGE_EVENT_TYPE.SlidePrev
      });
    }
  }

  window.addEventListener('load', sendHeight);
  window.addEventListener('resize', sendHeight);
  document.addEventListener('wheel', hanlderWheel);
  document.addEventListener('keydown', hanlderKeyDown);

  sendHeight();
  slideSelectedEdit();

})();
