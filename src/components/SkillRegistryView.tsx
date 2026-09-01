import React, { useState } from 'react';
import { SkillDefinition } from '../types';
import { 
  Code, Terminal, Shield, Play, CheckCircle2, 
  AlertTriangle, RefreshCw, Plus, ToggleLeft, ToggleRight, 
  Sliders, Search, Layers, FileText, Check, Copy, Zap
} from 'lucide-react';

interface SkillRegistryViewProps {
  skills: SkillDefinition[];
  onToggleSkill: (id: string, enabled: boolean) => void;
  onAddSkill: (skill: Omit<SkillDefinition, 'id' | 'callCount' | 'successRate'>) => void;
  onTestSkill: (skillId: string, params: Record<string, any>) => Promise<string>;
}

export const SkillRegistryView: React.FC<SkillRegistryViewProps> = ({
  skills,
  onToggleSkill,
  onAddSkill,
  onTestSkill
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSkill, setActiveSkill] = useState<SkillDefinition | null>(skills[0] || null);
  const [isExecutingTest, setIsExecutingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testParamsInput, setTestParamsInput] = useState<string>('{\n  "text": "Testing Fish Audio neural TTS pipeline chunk.",\n  "normalize": true\n}');
  const [isAddingSkill, setIsAddingSkill] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Skill Form State
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState<SkillDefinition['category']>('mcp');
  const [newMode, setNewMode] = useState<SkillDefinition['executionMode']>('autonomous');
  const [newMarkdown, setNewMarkdown] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const filteredSkills = skills.filter(skill => {
    const matchesCat = selectedCategory === 'all' || skill.category === selectedCategory;
    const matchesSearch = skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const handleRunTest = async (skill: SkillDefinition) => {
    setIsExecutingTest(true);
    setTestResult(null);
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(testParamsInput);
      } catch (e) {
        parsed = { raw: testParamsInput };
      }
      const output = await onTestSkill(skill.id, parsed);
      setTestResult(output);
      showToast(`Skill ${skill.name} executed successfully.`);
    } catch (err: any) {
      setTestResult(`Execution Error: ${err.message || String(err)}`);
    } finally {
      setIsExecutingTest(false);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    onAddSkill({
      name: newName,
      description: newDesc,
      category: newCategory,
      version: '1.0.0',
      enabled: true,
      permissions: ['network'],
      executionMode: newMode,
      parametersSchema: { input: { type: 'string', required: true } },
      markdownSpec: newMarkdown || `---\nname: ${newName}\ndescription: ${newDesc}\n---\n# Skill Instructions\n1. Process input payload\n2. Return JSON response`,
      author: 'Hermes Operator',
      sourceFile: `/mcp/${newName}.ts`
    });

    setNewName('');
    setNewDesc('');
    setNewMarkdown('');
    setIsAddingSkill(false);
    showToast(`Skill ${newName} registered successfully.`);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D0E1A] p-5 rounded-2xl border border-[#1E2238] shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#615EFF] to-[#38BDF8] flex items-center justify-center shadow-lg shadow-[#615EFF]/25">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Skill Registry & MCP Manager</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                MCP v1.2 SPEC
              </span>
            </div>
            <p className="text-xs text-[#9AA2C6] mt-0.5">
              Deterministic skill definitions, sandboxed executors, and permission security boundaries.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddingSkill(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white text-xs font-semibold rounded-xl shadow-lg shadow-[#615EFF]/20 transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Register New Skill</span>
        </button>
      </div>

      {toastMessage && (
        <div className="p-3 bg-[#00D26A]/10 border border-[#00D26A]/30 rounded-xl text-xs text-[#00D26A] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Skill List & Filters */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] p-3 rounded-xl space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#5F6589]" />
              <input
                type="text"
                placeholder="Search skills, tools, MCP servers..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#141628] border border-[#1E2238] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {['all', 'system', 'mcp', 'tool', 'integration'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg font-mono text-[10px] uppercase transition ${
                    selectedCategory === cat ? 'bg-[#615EFF] text-white font-bold' : 'bg-[#141628] text-[#8E94B8] hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[620px] overflow-y-auto pr-1">
            {filteredSkills.map(skill => {
              const isSelected = activeSkill?.id === skill.id;
              return (
                <div
                  key={skill.id}
                  onClick={() => {
                    setActiveSkill(skill);
                    setTestResult(null);
                  }}
                  className={`p-3.5 rounded-xl border transition cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[#15172A] border-[#615EFF] shadow-lg shadow-[#615EFF]/10'
                      : 'bg-[#0D0E1A] border-[#1E2238] hover:border-[#2D3354] hover:bg-[#111324]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                      <Code className="w-3.5 h-3.5 text-[#615EFF]" />
                      {skill.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSkill(skill.id, !skill.enabled);
                      }}
                      className="text-xs"
                      title={skill.enabled ? 'Disable Skill' : 'Enable Skill'}
                    >
                      {skill.enabled ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00D26A]/15 text-[#00D26A] border border-[#00D26A]/30">
                          ENABLED
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#FF5E8E]/15 text-[#FF5E8E] border border-[#FF5E8E]/30">
                          DISABLED
                        </span>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] text-[#9AA2C6] line-clamp-2 leading-relaxed">
                    {skill.description}
                  </p>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#1C2035] text-[10px] text-[#8E94B8] font-mono">
                    <span className="uppercase text-[#38BDF8]">{skill.category}</span>
                    <span>Calls: {skill.callCount} ({skill.successRate}%)</span>
                  </div>
                </div>
              );
            })}

            {filteredSkills.length === 0 && (
              <div className="p-8 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-xl text-[#5F6589] text-xs">
                No skills matching the current filter.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Skill Inspector & Interactive Test Harness */}
        <div className="lg:col-span-7">
          {activeSkill ? (
            <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl p-5 space-y-5">
              <div className="flex items-start justify-between gap-4 border-b border-[#1E2238] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#615EFF] px-2 py-0.5 bg-[#615EFF]/10 border border-[#615EFF]/30 rounded">
                      {activeSkill.category.toUpperCase()}
                    </span>
                    <span className="text-xs text-[#8E94B8] font-mono">v{activeSkill.version}</span>
                    <span className="text-[10px] font-mono text-[#00D26A]">{activeSkill.executionMode}</span>
                  </div>
                  <h2 className="text-base font-bold text-white mt-1.5 font-mono">
                    {activeSkill.name}
                  </h2>
                  <p className="text-xs text-[#9AA2C6] mt-1">
                    {activeSkill.description}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[10px] font-mono text-[#5F6589]">SUCCESS RATE</div>
                  <div className="text-lg font-bold text-[#00D26A] font-mono">{activeSkill.successRate}%</div>
                </div>
              </div>

              {/* Permissions & Security Flags */}
              <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#A5A2FF] flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#615EFF]" />
                  <span>Sandbox Security & Permissions</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeSkill.permissions.map(perm => (
                    <span key={perm} className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C2035] text-[#38BDF8] border border-[#2D3354]">
                      🔒 {perm}
                    </span>
                  ))}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1C2035] text-[#8E94B8]">
                    File: {activeSkill.sourceFile}
                  </span>
                </div>
              </div>

              {/* Markdown Specification (SKILL.md) */}
              <div className="bg-[#121424] border border-[#1E2238] p-3.5 rounded-xl space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#8E94B8] flex items-center justify-between">
                  <span>SKILL.md Spec</span>
                  <span className="text-[10px] text-[#5F6589]">YAML Frontmatter + Markdown</span>
                </div>
                <pre className="text-xs text-[#E2E8F0] font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border border-[#161828] max-h-40 overflow-y-auto">
                  {activeSkill.markdownSpec}
                </pre>
              </div>

              {/* Interactive Test Harness */}
              <div className="bg-[#121424] border border-[#1E2238] p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#00D26A] flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    <span>Live Test Harness</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#5F6589]">Mock / Sandbox Runner</span>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-[#8E94B8] uppercase block mb-1">
                    JSON Input Payload
                  </label>
                  <textarea
                    value={testParamsInput}
                    onChange={e => setTestParamsInput(e.target.value)}
                    rows={3}
                    className="w-full bg-[#080911] border border-[#161828] rounded-lg p-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#615EFF]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => handleRunTest(activeSkill)}
                    disabled={isExecutingTest}
                    className="flex items-center gap-2 px-4 py-2 bg-[#615EFF] hover:bg-[#5653d9] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95"
                  >
                    <Play className={`w-3.5 h-3.5 ${isExecutingTest ? 'animate-spin' : ''}`} />
                    <span>{isExecutingTest ? 'Executing In Sandbox...' : 'Run Skill Test'}</span>
                  </button>
                  <span className="text-[10px] font-mono text-[#8E94B8]">
                    Last run: {activeSkill.lastExecuted || 'Never'}
                  </span>
                </div>

                {testResult && (
                  <div className="mt-3 pt-3 border-t border-[#1C2035] space-y-1 animate-in fade-in">
                    <div className="text-[10px] font-mono text-[#00D26A]">TEST EXECUTION OUTPUT</div>
                    <pre className="text-xs text-[#00D26A] font-mono whitespace-pre-wrap leading-relaxed bg-[#080911] p-3 rounded-lg border border-[#00D26A]/30">
                      {testResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-[#0D0E1A] border border-[#1E2238] rounded-2xl text-[#5F6589]">
              Select a skill from the left directory to inspect schema, permissions, and run tests.
            </div>
          )}
        </div>
      </div>

      {/* Modal: Register New Skill */}
      {isAddingSkill && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0D0E1A] border border-[#1E2238] rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[#1E2238] pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[#615EFF]" />
                <h3 className="text-sm font-bold text-white">Register MCP Server / Custom Skill</h3>
              </div>
              <button onClick={() => setIsAddingSkill(false)} className="text-[#8E94B8] hover:text-white text-xs">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Skill Function Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. mcp:stripe_invoice_fetcher"
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Description</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder="Brief description of functional capabilities..."
                  required
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as SkillDefinition['category'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="mcp">MCP Server</option>
                    <option value="tool">Local Tool</option>
                    <option value="integration">API Integration</option>
                    <option value="system">System Core</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">Execution Mode</label>
                  <select
                    value={newMode}
                    onChange={e => setNewMode(e.target.value as SkillDefinition['executionMode'])}
                    className="w-full bg-[#141628] border border-[#1E2238] rounded-lg p-2 text-xs text-white focus:outline-none focus:border-[#615EFF]"
                  >
                    <option value="autonomous">Autonomous Execution</option>
                    <option value="confirm_first">Confirm Before Execution</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#8E94B8] uppercase block mb-1">SKILL.md Markdown Specification</label>
                <textarea
                  value={newMarkdown}
                  onChange={e => setNewMarkdown(e.target.value)}
                  rows={4}
                  placeholder={`---\nname: my_skill\npermissions: ["network"]\n---\n# Instructions\n1. Do XYZ`}
                  className="w-full bg-[#141628] border border-[#1E2238] rounded-xl p-2.5 text-xs text-white font-mono placeholder-[#5F6589] focus:outline-none focus:border-[#615EFF]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#1E2238]">
                <button
                  type="button"
                  onClick={() => setIsAddingSkill(false)}
                  className="px-4 py-2 bg-[#1E2238] text-[#8E94B8] hover:text-white rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#615EFF] hover:bg-[#5653d9] text-white rounded-lg text-xs font-bold transition shadow-lg shadow-[#615EFF]/20"
                >
                  Register Skill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
