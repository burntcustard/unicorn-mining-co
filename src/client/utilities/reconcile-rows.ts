/**
 * Update list markup while retaining rows with the same data-key, their focus,
 * and canvas thumbnails. Existing nodes move without resetting browser state.
 */
export const reconcileRows = (element: HTMLElement, html: string) => {
  const template = document.createElement('template');

  template.innerHTML = html;
  const rows = new Map(
    [...element.querySelectorAll('[data-key]')].map((row) => [
      row.getAttribute('data-key'),
      row,
    ]),
  );

  const patch = (target: Element, source: Element | DocumentFragment) => {
    if (source instanceof Element) {
      // Attribute removal changes the live NamedNodeMap.
      const attributes = Array.from(target.attributes);

      for (const attribute of attributes) {
        if (
          !source.hasAttribute(attribute.nodeName) &&
          !(
            target.localName === 'canvas' &&
            ['width', 'height'].includes(attribute.nodeName)
          )
        ) {
          target.removeAttribute(attribute.nodeName);
        }
      }

      for (const attribute of source.attributes) {
        if (target.getAttribute(attribute.nodeName) !== attribute.value) {
          target.setAttribute(attribute.nodeName, attribute.value);
        }
      }
    }

    let cursor = target.firstChild;

    for (const child of source.childNodes) {
      const key = child instanceof Element && child.getAttribute('data-key');
      const matching = key
        ? rows.get(key)
        : cursor?.nodeType === child.nodeType &&
            (!(child instanceof Element) ||
              (cursor instanceof Element &&
                cursor.localName === child.localName &&
                !cursor.hasAttribute('data-key')))
          ? cursor
          : undefined;
      const node = matching || child.cloneNode(false);

      if (node !== cursor) {
        if (node.parentNode && node.isConnected === target.isConnected) {
          target.moveBefore(node, cursor);
        } else {
          target.insertBefore(node, cursor);
        }
      }

      if (node instanceof Element && child instanceof Element) {
        patch(node, child);
      } else if (node.nodeValue !== child.nodeValue) {
        node.nodeValue = child.nodeValue;
      }

      cursor = node.nextSibling;
    }

    while (cursor) {
      const next = cursor.nextSibling;

      target.removeChild(cursor);
      cursor = next;
    }
  };

  patch(element, template.content);
};
