import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  CheckCircle2,
  Users,
  RefreshCw,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';

interface RealWorkspace {
  workspace_id: string;
  name: string;
  memberCount: number;
  created_at: string;
  updated_at: string;
}

interface WorkspacesViewProps {
  activeWorkspaceId?: string;
  onSwitchWorkspace?: (workspaceId: string) => void;
}

// ---------------------------------------------------------------------------
// SYNTHOS — Workspace administration (Pass III / D3).
//
// Replaces a fully fabricated demo tenant list (fake slugs, fake API
// health, fake TON stats, fake "Boundary isolation verified" claims) with
// real data from GET/POST /api/master-admin/workspaces — a real
// `workspaces` table row per entry, a real member count derived from
// workspace_memberships. This is a platform_admin-only surface: a
// non-admin sees an honest access-denied state, not a crash or fake data.
// ---------------------------------------------------------------------------

export const WorkspacesView: React.FC<WorkspacesViewProps> = ({ activeWorkspaceId, onSwitchWorkspace }) => {
  const [workspaces, setWorkspaces] = useState<RealWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creating, setCreating] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch('/api/master-admin/workspaces');
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok || data.success === false) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setWorkspaces(data.workspaces || []);
    } catch (err: any) {
      setError(err?.message || 'Network error contacting the workspace API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleSwitchWorkspace = (ws: RealWorkspace) => {
    if (onSwitchWorkspace) {
      onSwitchWorkspace(ws.workspace_id);
      showToast(`Switched active workspace to "${ws.name}".`);
    } else {
      showToast('Workspace switching is not wired into this view.');
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/master-admin/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWsName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        showToast(`Could not create workspace: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setNewWsName('');
      setShowCreateModal(false);
      showToast(`Workspace "${data.workspace.name}" created. Assign members from Master Admin → Users.`);
      fetchWorkspaces();
    } catch (err: any) {
      showToast(`Could not create workspace: ${err?.message || 'network error'}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2D3352] pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#615EFF]/15 border border-[#615EFF]/30 text-[#8C8AFF]">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Workspaces</h1>
            <p className="text-xs text-[#8E94B8] mt-0.5">
              Real, platform-administered workspaces and their member counts.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchWorkspaces}
            disabled={loading}
            className="p-2 rounded-lg bg-[#141628] border border-[#2D3352] text-[#8E94B8] hover:text-white transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] text-white text-xs font-bold font-mono transition flex items-center gap-2 shadow-lg shadow-[#615EFF]/25 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Workspace</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3.5 rounded-xl bg-[#00D26A]/15 border border-[#00D26A]/40 text-[#00D26A] text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {forbidden ? (
        <div className="p-8 text-center bg-[#0F111E] border border-[#2D3352] rounded-2xl space-y-2">
          <AlertTriangle className="w-6 h-6 text-[#F59E0B] mx-auto" />
          <p className="text-xs text-[#8E94B8]">You do not have platform administrator access to manage workspaces.</p>
        </div>
      ) : error ? (
        <div className="p-3.5 rounded-xl bg-[#FF5E8E]/15 border border-[#FF5E8E]/40 text-[#FF5E8E] text-xs font-mono">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-[#8E94B8] py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading workspaces…
        </div>
      ) : workspaces.length === 0 ? (
        <div className="p-8 text-center bg-[#0F111E] border border-[#2D3352] rounded-2xl text-xs text-[#8E94B8]">
          No workspaces exist yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {workspaces.map((ws) => {
            const isActive = ws.workspace_id === activeWorkspaceId;
            return (
              <div
                key={ws.workspace_id}
                className={`bg-[#0F111E] border rounded-2xl p-5 shadow-xl transition space-y-4 flex flex-col justify-between ${
                  isActive ? 'border-[#615EFF] ring-1 ring-[#615EFF]/50' : 'border-[#2D3352] hover:border-[#2D3352]/90'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C1F37] border border-[#2D3352] text-[#8C8AFF] font-bold flex items-center gap-1">
                      <Users className="w-3 h-3" /> {ws.memberCount} member{ws.memberCount === 1 ? '' : 's'}
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> ACTIVE
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-wide">{ws.name}</h3>
                    <p className="text-[11px] font-mono text-[#8E94B8] mt-0.5">{ws.workspace_id}</p>
                  </div>
                  <div className="bg-[#141628] p-3 rounded-xl border border-[#2D3352]/60 text-[11px] font-mono text-[#8E94B8]">
                    Created {new Date(ws.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleSwitchWorkspace(ws)}
                  disabled={isActive}
                  className={`w-full mt-4 py-2 rounded-xl text-xs font-bold font-mono transition cursor-pointer ${
                    isActive
                      ? 'bg-[#141628] border border-[#2D3352] text-[#8E94B8] cursor-default'
                      : 'bg-[#615EFF] hover:bg-[#5653D9] text-white shadow-lg shadow-[#615EFF]/25'
                  }`}
                >
                  {isActive ? 'Current Active Workspace' : 'Switch to Workspace'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0F111E] border border-[#2D3352] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#2D3352] pb-3">
              <h3 className="text-sm font-bold text-white">Create Workspace</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-[#8E94B8] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-white block mb-1">Workspace Name</label>
                <input
                  type="text"
                  required
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="e.g., Acme Corp"
                  className="w-full bg-[#141628] border border-[#2D3352] rounded-xl px-3 py-2 text-xs text-white placeholder-[#6A719C] focus:outline-none focus:border-[#615EFF]"
                />
              </div>
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2 rounded-xl bg-[#141628] border border-[#2D3352] text-xs font-bold text-[#8E94B8] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 rounded-xl bg-[#615EFF] hover:bg-[#5653D9] disabled:opacity-50 text-xs font-bold text-white shadow-lg shadow-[#615EFF]/25 font-mono cursor-pointer"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
