const MOBILE_PANEL_IDS = Object.freeze([
  'location-bar',
  'data-panel',
  'global-context-panel',
  'control-panel',
  'pp-toggles',
]);

/**
 * Enforce the one-sheet mobile contract even when a panel is expanded by an
 * application event rather than by the mobile navigation itself. The most
 * recently expanded mutation owns the sheet; any older open panel is closed.
 *
 * @param {object} input
 * @param {HTMLElement[]} input.panels
 * @param {MutationRecord[]} [input.records]
 * @param {(id: string) => void} input.collapse
 * @returns {HTMLElement|null}
 */
export function reconcileExclusiveMobilePanels({ panels, records = [], collapse }) {
  const panelSet = new Set(panels);
  let owner = null;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const target = records[index]?.target;
    if (panelSet.has(target) && !target.classList.contains('collapsed')) {
      owner = target;
      break;
    }
  }
  owner ||= panels.find((panel) => !panel.classList.contains('collapsed')) || null;
  if (!owner) return null;
  for (const panel of panels) {
    if (panel !== owner && !panel.classList.contains('collapsed')) collapse(panel.id);
  }
  return owner;
}

/**
 * Mobile-only map navigation. Desktop panel state remains authoritative: all
 * mobile opens are transient and never overwrite a person's saved layout.
 */
export function initMobileNavigation({ styleManager, documentRef = document } = {}) {
  const nav = documentRef.getElementById('mobile-command-nav');
  const menu = documentRef.getElementById('mobile-more-menu');
  const moreToggle = documentRef.getElementById('mobile-more-toggle');
  const moreClose = documentRef.getElementById('mobile-more-close');
  const backdrop = documentRef.getElementById('mobile-sheet-backdrop');
  if (!nav || !menu || !moreToggle || !backdrop) return null;

  const media = globalThis.matchMedia?.('(max-width: 720px)');
  const isMobile = () => media?.matches ?? globalThis.innerWidth <= 720;
  const panelButtons = [...documentRef.querySelectorAll('[data-mobile-panel]')];
  const panels = MOBILE_PANEL_IDS
    .map((id) => documentRef.getElementById(id))
    .filter(Boolean);

  const collapsePanel = (id) => styleManager?.setPanelCollapsed?.(id, true, {
    explicit: true,
    persist: false,
    syncShare: false,
  });

  const expandedPanel = () => panels.find((panel) => !panel.classList.contains('collapsed')) || null;

  const sync = () => {
    if (!isMobile()) {
      documentRef.body.classList.remove('mobile-sheet-open');
      backdrop.hidden = true;
      menu.hidden = true;
      moreToggle.setAttribute('aria-expanded', 'false');
      return;
    }
    const active = expandedPanel();
    const menuOpen = !menu.hidden;
    documentRef.body.classList.toggle('mobile-sheet-open', Boolean(active) || menuOpen);
    backdrop.hidden = !(active || menuOpen);
    moreToggle.setAttribute('aria-expanded', String(menuOpen));
    for (const button of panelButtons) {
      const selected = button.dataset.mobilePanel === active?.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-expanded', String(selected));
    }
  };

  const closeAll = () => {
    for (const panel of panels) collapsePanel(panel.id);
    menu.hidden = true;
    sync();
  };

  const openPanel = (id) => {
    if (!isMobile() || !MOBILE_PANEL_IDS.includes(id)) return;
    const target = documentRef.getElementById(id);
    if (!target) return;
    const alreadyOpen = !target.classList.contains('collapsed');
    for (const panel of panels) {
      if (panel !== target && !panel.classList.contains('collapsed')) collapsePanel(panel.id);
    }
    menu.hidden = true;
    styleManager?.setPanelCollapsed?.(id, alreadyOpen, {
      explicit: true,
      persist: false,
      syncShare: false,
    });
    if (!alreadyOpen && id === 'location-bar') styleManager?.focusLocationSearch?.();
    sync();
  };

  const onPanelButton = (event) => openPanel(event.currentTarget.dataset.mobilePanel);
  for (const button of panelButtons) button.addEventListener('click', onPanelButton);

  const onMoreToggle = () => {
    if (!isMobile()) return;
    const opening = menu.hidden;
    for (const panel of panels) {
      if (!panel.classList.contains('collapsed')) collapsePanel(panel.id);
    }
    menu.hidden = !opening;
    sync();
    if (opening) moreClose?.focus({ preventScroll: true });
  };
  const onMoreClose = () => {
    menu.hidden = true;
    sync();
    moreToggle.focus({ preventScroll: true });
  };
  moreToggle.addEventListener('click', onMoreToggle);
  moreClose?.addEventListener('click', onMoreClose);
  backdrop.addEventListener('click', closeAll);

  const actionTargets = {
    reset: 'reset-globe-view',
  };
  const actionButtons = [...menu.querySelectorAll('[data-mobile-action]')];
  const onAction = (event) => {
    const action = event.currentTarget.dataset.mobileAction;
    menu.hidden = true;
    sync();
    if (action === 'logout') {
      documentRef.getElementById('logout-form')?.requestSubmit?.();
      return;
    }
    documentRef.getElementById(actionTargets[action])?.click();
  };
  for (const button of actionButtons) button.addEventListener('click', onAction);

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !isMobile()) return;
    if (menu.hidden && !expandedPanel()) return;
    event.preventDefault();
    closeAll();
  };
  documentRef.addEventListener('keydown', onKeyDown);

  // A short drag from the sheet header closes it. Inputs, scrolling content,
  // and ordinary taps never enter this gesture lane.
  const swipeCleanups = [];
  for (const panel of panels) {
    let startY = null;
    let pointerId = null;
    const onPointerDown = (event) => {
      if (!isMobile() || panel.classList.contains('collapsed')) return;
      if (event.target.closest('button, input, select, textarea, a, [role="button"]')) return;
      const rect = panel.getBoundingClientRect();
      if (event.clientY - rect.top > 64) return;
      startY = event.clientY;
      pointerId = event.pointerId;
      panel.classList.add('mobile-sheet-dragging');
      panel.setPointerCapture?.(pointerId);
    };
    const onPointerMove = (event) => {
      if (event.pointerId !== pointerId || startY == null) return;
      const distance = Math.max(0, event.clientY - startY);
      panel.style.setProperty('--mobile-sheet-drag-y', `${distance}px`);
    };
    const onPointerEnd = (event) => {
      if (event.pointerId !== pointerId || startY == null) return;
      const distance = Math.max(0, event.clientY - startY);
      panel.releasePointerCapture?.(pointerId);
      panel.classList.remove('mobile-sheet-dragging');
      panel.style.removeProperty('--mobile-sheet-drag-y');
      startY = null;
      pointerId = null;
      if (distance > 72) collapsePanel(panel.id);
      sync();
    };
    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', onPointerEnd);
    panel.addEventListener('pointercancel', onPointerEnd);
    swipeCleanups.push(() => {
      panel.removeEventListener('pointerdown', onPointerDown);
      panel.removeEventListener('pointermove', onPointerMove);
      panel.removeEventListener('pointerup', onPointerEnd);
      panel.removeEventListener('pointercancel', onPointerEnd);
    });
  }

  const observer = new MutationObserver((records) => {
    if (isMobile()) reconcileExclusiveMobilePanels({ panels, records, collapse: collapsePanel });
    sync();
  });
  for (const panel of panels) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  const onMediaChange = () => {
    if (!isMobile()) {
      menu.hidden = true;
      documentRef.body.classList.remove('mobile-sheet-open');
      backdrop.hidden = true;
    }
    sync();
  };
  media?.addEventListener?.('change', onMediaChange);
  if (isMobile()) {
    for (const panel of panels) collapsePanel(panel.id);
  }
  sync();

  return {
    closeAll,
    dispose() {
      observer.disconnect();
      media?.removeEventListener?.('change', onMediaChange);
      documentRef.removeEventListener('keydown', onKeyDown);
      moreToggle.removeEventListener('click', onMoreToggle);
      moreClose?.removeEventListener('click', onMoreClose);
      backdrop.removeEventListener('click', closeAll);
      for (const button of panelButtons) button.removeEventListener('click', onPanelButton);
      for (const button of actionButtons) button.removeEventListener('click', onAction);
      for (const cleanup of swipeCleanups) cleanup();
    },
  };
}
