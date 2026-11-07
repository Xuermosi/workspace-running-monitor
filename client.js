window.__ModuleLoader__.load({
  id: '@local/workspace-running-monitor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'workspace-running-monitor';
    const OPEN_DELAY = 150;
    const CLOSE_DELAY = 120;
    const RECENT_LIMIT = 10;
    const STORAGE_KEY = 'workspace-running-monitor:recently-ended';

    function loadRecent() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = JSON.parse(raw ?? '[]');
        if (!Array.isArray(parsed)) return [];
        const byId = new Map();
        for (const entry of parsed) {
          if (typeof entry?.id !== 'string' || !Number.isFinite(entry.endedAt)) continue;
          const previous = byId.get(entry.id);
          if (previous === undefined || entry.endedAt > previous.endedAt) byId.set(entry.id, entry);
        }
        return [...byId.values()].sort((a, b) => b.endedAt - a.endedAt).slice(0, RECENT_LIMIT);
      } catch {
        return [];
      }
    }

    function persistRecent(entries) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      } catch {}
    }

    const zh = {
      button: '正在运行的会话',
      ungrouped: '未分组',
      untitled: '未命名',
    };
    const en = {
      button: 'Running sessions',
      ungrouped: 'Ungrouped',
      untitled: 'Untitled',
    };

    /** Shared pointer, focus, and list state between the footer button and the frame overlay. */
    function createMenu() {
      const listeners = new Set();
      const state = {
        open: false,
        groups: [],
        anchor: null,
        pointer: false,
        focus: false,
        recent: loadRecent(),
      };
      const notify = () => {
        for (const listener of listeners) listener();
      };
      return {
        get: () => state,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        patch(next) {
          Object.assign(state, next);
          notify();
        },
        recordEnded(id, endedAt) {
          const rest = state.recent.filter((entry) => entry.id !== id);
          const next = [{ id, endedAt }, ...rest].slice(0, RECENT_LIMIT);
          state.recent = next;
          persistRecent(next);
          notify();
        },
        dropRecent(id) {
          if (state.recent.every((entry) => entry.id !== id)) return;
          const next = state.recent.filter((entry) => entry.id !== id);
          state.recent = next;
          persistRecent(next);
          notify();
        },
      };
    }

    function runningFlag(statuses, summary) {
      const live = statuses?.get?.(summary.id);
      if (live && typeof live.running === 'boolean') return live.running;
      return summary.running === true;
    }

    /** One level only: a direct child counts, that child's own children do not. */
    function directChildRunning(sessions, statuses, summary) {
      const catalog = sessions.projectionsBySession?.[summary.id]?.values?.subagentCatalog;
      if (!Array.isArray(catalog)) return false;
      return catalog.some((child) => {
        const id = child?.id;
        if (typeof id !== 'string') return false;
        const live = statuses?.get?.(id);
        if (live && typeof live.running === 'boolean') return live.running;
        return sessions.byId?.[id]?.running === true;
      });
    }

    function listsReady(sessions, workspaces) {
      if (sessions?.phase !== 'ready' || workspaces?.phase !== 'ready') return false;
      return workspaces.state !== 'loading';
    }

    function recentIndex(recent) {
      const map = new Map();
      for (const entry of recent) map.set(entry.id, entry.endedAt);
      return map;
    }

    function sessionStatus(sessions, statuses, summary, recentMap) {
      const live = statuses?.get?.(summary.id);
      const pending = live?.pendingInteraction !== undefined && live?.pendingInteraction !== null;
      const running = runningFlag(statuses, summary) || directChildRunning(sessions, statuses, summary);
      const unread = live?.completionUnread === true;
      if (pending) return 'attention';
      if (running) return 'running';
      const endedAt = recentMap.get(summary.id);
      if (unread) return { state: 'done', endedAt: endedAt ?? Number.POSITIVE_INFINITY };
      if (endedAt !== undefined) return { state: 'done', endedAt };
      return null;
    }

    /** Sessions needing attention plus recently ended, grouped in workspace-registry order. */
    function runningGroups(sessions, statuses, workspaces, recent, text) {
      if (!listsReady(sessions, workspaces)) return [];
      const archived = new Set(workspaces.archivedSessionIds ?? []);
      const recentMap = recentIndex(recent);
      const rowsById = new Map();
      for (const id of sessions.ids ?? []) {
        const summary = sessions.byId?.[id];
        if (summary == null || summary.origin === 'subagent' || archived.has(id)) continue;
        const found = sessionStatus(sessions, statuses, summary, recentMap);
        if (found === null) continue;
        if (found === 'attention' || found === 'running') rowsById.set(id, { ...summary, monitorState: found });
        else rowsById.set(id, { ...summary, monitorState: found.state, endedAt: found.endedAt });
      }
      const priority = { attention: 0, running: 1, done: 2 };
      const orderRows = (rows) => rows.sort((a, b) => {
        const byState = priority[a.monitorState] - priority[b.monitorState];
        if (byState !== 0) return byState;
        if (a.monitorState === 'done') return (b.endedAt ?? 0) - (a.endedAt ?? 0);
        return 0;
      });
      const claimed = new Set();
      const groups = [];
      for (const workspace of workspaces.items ?? []) {
        const rows = orderRows((workspace.sessionIds ?? []).flatMap((id) => {
          const row = rowsById.get(id);
          if (row === undefined || claimed.has(id)) return [];
          claimed.add(id);
          return [row];
        }));
        if (rows.length > 0) {
          const label = typeof workspace.title === 'string' ? workspace.title.trim() : '';
          groups.push({
            key: workspace.workspaceId,
            label: label !== '' ? label : text('untitled'),
            rows,
          });
        }
      }
      const loose = orderRows([...rowsById.values()].filter((row) => !claimed.has(row.id)));
      if (loose.length > 0) groups.push({ key: '', label: text('ungrouped'), rows: loose });
      return groups;
    }

    function sessionLabel(summary, text) {
      const title = typeof summary.title === 'string' ? summary.title.trim() : '';
      return title !== '' ? title : text('untitled');
    }

    function useMenu(menu) {
      const [, refresh] = React.useState(0);
      React.useEffect(() => menu.subscribe(() => refresh((value) => value + 1)), [menu]);
      return menu.get();
    }

    function MonitorButton({ wide, menu, text, groups, card = false, cardPosition }) {
      const button = React.useRef(null);
      const current = useMenu(menu);
      const visible = card ? wide !== false && groups.length > 0 : wide && groups.length > 0;
      React.useEffect(() => {
        if (visible) return undefined;
        menu.patch({ open: false, groups: [], anchor: null, pointer: false });
        return undefined;
      }, [visible, menu]);
      if (!visible) return null;

      const holdOpen = () => {
        window.clearTimeout(menu.closeTimer);
        menu.patch({ pointer: true });
        if (menu.get().open) return;
        window.clearTimeout(menu.openTimer);
        menu.openTimer = window.setTimeout(() => {
          menu.patch({ open: true, anchor: button.current, groups });
        }, OPEN_DELAY);
      };
      const release = () => {
        window.clearTimeout(menu.openTimer);
        menu.patch({ pointer: false });
        window.clearTimeout(menu.closeTimer);
        menu.closeTimer = window.setTimeout(() => {
          const current = menu.get();
          if (!current.pointer && !current.focus) menu.patch({ open: false });
        }, CLOSE_DELAY);
      };

      return h('button', {
        ref: button,
        type: 'button',
        className: `workspace-running-monitor-button${card ? ' workspace-running-monitor-card' : ''}`,
        ...(card && cardPosition ? { style: {
          position: 'fixed',
          left: cardPosition.left,
          top: cardPosition.top,
          width: cardPosition.width,
          height: 30,
        } } : {}),
        'aria-label': text('button'),
        'aria-haspopup': 'menu',
        'aria-expanded': current.open,
        'data-state': groups.some((group) => group.rows.some((row) => row.monitorState === 'attention'))
          ? 'attention'
          : groups.some((group) => group.rows.some((row) => row.monitorState === 'running'))
            ? 'running'
            : 'done',
        onMouseDown(event) {
          event.preventDefault();
          event.stopPropagation();
        },
        onClick(event) {
          event.preventDefault();
          event.stopPropagation();
        },
        onPointerEnter: holdOpen,
        onPointerLeave: release,
        onFocus(event) {
          const from = event.relatedTarget;
          if (from instanceof Node && menu.root?.contains(from)) {
            menu.patch({ focus: true });
            return;
          }
          window.clearTimeout(menu.closeTimer);
          window.clearTimeout(menu.openTimer);
          menu.patch({ focus: true, open: true, anchor: button.current, groups });
        },
        onBlur(event) {
          const next = event.relatedTarget;
          if (next instanceof Node && menu.root?.contains(next)) return;
          menu.patch({ focus: false });
          if (!menu.get().pointer) menu.patch({ open: false });
        },
      }, card ? [
        h('span', { key: 'label', className: 'workspace-running-monitor-card-label' }, text('button')),
        h('span', { key: 'dot', className: 'workspace-running-monitor-dot', 'aria-hidden': 'true' }),
      ] : h('span', { className: 'workspace-running-monitor-dot', 'aria-hidden': 'true' }));
    }

    function MonitorCard(props) {
      return h(MonitorButton, { ...props, card: true });
    }

    function Overlay({ menu, text, openSession, ...props }) {
      return h(React.Fragment, null,
        h(Footer, { ...props, menu, text, card: true }),
        h(MonitorMenu, { menu, text, openSession }),
      );
    }

    function MonitorMenu({ menu, text, openSession }) {
      const items = React.useRef([]);
      const wasOpen = React.useRef(false);
      const current = useMenu(menu);
      const anchor = current.anchor;
      React.useEffect(() => {
        const opening = current.open && !wasOpen.current;
        wasOpen.current = current.open;
        if (!opening || anchor == null || document.activeElement !== anchor) return undefined;
        const frame = window.requestAnimationFrame(() => {
          items.current[0]?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
      }, [current.open, anchor]);

      if (!current.open || anchor == null || current.groups.length === 0) return null;
      const rect = anchor.getBoundingClientRect();
      const maxHeight = Math.round(window.innerHeight / 2);
      const above = rect.top >= maxHeight || rect.top >= window.innerHeight - rect.bottom;
      const style = {
        position: 'fixed',
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
        width: 240,
        maxHeight,
        zIndex: 40,
        pointerEvents: 'auto',
      };
      if (above) style.bottom = window.innerHeight - rect.top;
      else style.top = rect.bottom;

      const rows = current.groups.flatMap((group) => group.rows);
      items.current = [];
      const move = (event) => {
        const buttons = items.current.filter(Boolean);
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          menu.patch({ open: false, focus: false });
          anchor.focus();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const next = event.key === 'Home' ? 0
            : event.key === 'End' ? buttons.length - 1
              : event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1)
                : Math.max(index - 1, 0);
          buttons[next]?.focus();
        }
        if (event.key === 'Enter' && index >= 0) {
          event.preventDefault();
          openSession(rows[index].id);
          menu.patch({ open: false, pointer: false, focus: false });
        }
        if (event.key === 'Tab') menu.patch({ open: false, pointer: false, focus: false });
      };

      let itemIndex = 0;
      return h('div', {
        ref: (node) => {
          menu.root = node;
        },
        className: 'workspace-running-monitor-menu',
        role: 'menu',
        'aria-label': text('button'),
        style,
        onPointerEnter() {
          window.clearTimeout(menu.closeTimer);
          menu.patch({ pointer: true });
        },
        onPointerLeave() {
          menu.patch({ pointer: false });
          window.clearTimeout(menu.closeTimer);
          menu.closeTimer = window.setTimeout(() => {
            const latest = menu.get();
            if (!latest.pointer && !latest.focus) menu.patch({ open: false });
          }, CLOSE_DELAY);
        },
        onFocus() {
          menu.patch({ focus: true });
        },
        onBlur(event) {
          const next = event.relatedTarget;
          if (next instanceof Node && (menu.root?.contains(next) || next === anchor)) return;
          menu.patch({ focus: false });
          if (!menu.get().pointer) menu.patch({ open: false });
        },
        onKeyDown: move,
      }, current.groups.map((group) => h('div', { key: group.key, role: 'presentation' }, [
        h('div', { key: 'label', className: 'workspace-running-monitor-folder', role: 'presentation' }, group.label),
        ...group.rows.map((summary) => {
          const index = itemIndex;
          itemIndex += 1;
          return h('button', {
            key: summary.id,
            ref: (node) => {
              items.current[index] = node;
            },
            type: 'button',
            role: 'menuitem',
            tabIndex: -1,
            className: 'workspace-running-monitor-session',
            onClick() {
              openSession(summary.id);
              menu.patch({ open: false, pointer: false, focus: false });
            },
          }, [
            h('span', {
              key: 'dot',
              className: `workspace-running-monitor-dot workspace-running-monitor-dot-${summary.monitorState}`,
              'aria-hidden': 'true',
            }),
            h('span', { key: 'title' }, sessionLabel(summary, text)),
          ]);
        }),
      ])));
    }

    function Footer({ wide, useSessions, useSessionStatus, useWorkspaces, menu, text, card = false, hidden = false }) {
      useMenu(menu);
      const cardPosition = null;
      const sessions = useSessions((state) => state);
      const statuses = useSessionStatus((state) => state);
      const workspaces = useWorkspaces((state) => state);
      const wasRunning = React.useRef(new Map());
      React.useEffect(() => {
        if (statuses == null || sessions == null) return;
        const now = Date.now();
        const seen = new Map();
        for (const [id, live] of statuses) {
          const running = live?.running === true;
          seen.set(id, running);
          const was = wasRunning.current.get(id) === true;
          if (was && !running) menu.recordEnded(id, now);
          if (running) menu.dropRecent(id);
        }
        wasRunning.current = seen;
      }, [statuses, sessions, menu]);
      const groups = runningGroups(sessions, statuses, workspaces, menu.get().recent, text);
      React.useEffect(() => {
        const current = menu.get();
        if (current.open) menu.patch({ groups, anchor: current.anchor });
      }, [groups, menu]);
      return hidden ? null : h(MonitorButton, { wide, menu, text, groups, card, cardPosition });
    }

    const styleText = [
      '.workspace-running-monitor-button{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:default}',
      '.workspace-running-monitor-card{width:100%;height:36px;box-sizing:border-box;padding:0 12px;display:flex;align-items:center;justify-content:space-between;background:transparent;border:0;border-radius:8px;z-index:39}',
      '.workspace-running-monitor-card:hover,.workspace-running-monitor-card:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '.workspace-running-monitor-card-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.workspace-running-monitor-card .workspace-running-monitor-dot{width:10px;height:10px}',
      '.workspace-running-monitor-button:hover,.workspace-running-monitor-button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.workspace-running-monitor-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
      '.workspace-running-monitor-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2f9e6b);display:inline-block;flex:none}',
      '.workspace-running-monitor-dot-attention{background:var(--dsw-alias-state-warn-primary,#c47b23)}',
      '.workspace-running-monitor-dot-done{background:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-secondary,#7a7a7a))}',
      '.workspace-running-monitor-button[data-state=attention] .workspace-running-monitor-dot{background:var(--dsw-alias-state-warn-primary,#c47b23)}',
      '.workspace-running-monitor-button[data-state=done] .workspace-running-monitor-dot{background:var(--dsw-alias-state-idle-primary,#7a7a7a)}',
      '.workspace-running-monitor-menu{box-sizing:border-box;overflow:auto;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.28)}',
      '.workspace-running-monitor-folder{padding:6px 8px 2px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.workspace-running-monitor-session{width:100%;display:flex;align-items:center;gap:8px;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}',
      '.workspace-running-monitor-session:hover,.workspace-running-monitor-session:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));outline:none}',
    ].join('');

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-running-monitor: dictionaries');
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/workspace-running-monitor';
          tag.textContent = styleText;
          document.head.append(tag);
          return () => tag.remove();
        }, 'workspace-running-monitor: style');
        const menu = createMenu();
        const text = (key) => ctx.locale.bind(NS)(key);
        const openSession = (sessionId) => {
          ctx.get('uiWorkspace')?.openSession(sessionId);
        };
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'workspace-running-monitor',
          order: 20,
        }, (props) => h(Footer, { ...props, menu, text, card: true })));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-running-monitor',
          order: 20,
        }, () => h(MonitorMenu, { menu, text, openSession })));
      },
    };
  },
});
