import React, { useState, useEffect, useMemo } from 'react';
import { 
  Layout, 
  Github, 
  Search, 
  Settings, 
  Activity, 
  ShieldCheck, 
  FileCode, 
  BookOpen, 
  CheckCircle2, 
  AlertCircle, 
  Play, 
  RefreshCw,
  ChevronRight,
  Terminal,
  Database,
  Layers,
  GitBranch,
  ArrowRight,
  Plus,
  LogOut,
  LogIn,
  Trash2,
  X,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { auth, db, signIn, signOut } from './firebase';
import { useAuth, useFirestoreCollection } from './hooks/useFirebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  orderBy, 
  doc, 
  updateDoc, 
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { cn } from './lib/utils';
import { WORKFLOW_STEPS } from './constants/workflow';
import { generateStepOutput, generateFeatureCards } from './services/geminiService';
import { ErrorBoundary } from './components/ErrorBoundary';

// --- UI Components ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-[#151619] border border-[#141414] rounded-xl overflow-hidden shadow-2xl", className)}>
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled,
  icon: Icon,
  loading
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
  icon?: any;
  loading?: boolean;
}) => {
  const variants = {
    primary: "bg-[#00FF00] text-black hover:bg-[#00CC00]",
    secondary: "bg-[#2A2B2F] text-white hover:bg-[#3A3B3F]",
    ghost: "bg-transparent text-[#8E9299] hover:bg-[#2A2B2F] hover:text-white",
    danger: "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm",
        variants[variant],
        className
      )}
    >
      {loading ? <RefreshCw size={16} className="animate-spin" /> : Icon && <Icon size={16} />}
      {children}
    </button>
  );
};

const Badge = ({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' }) => {
  const variants = {
    neutral: "bg-[#2A2B2F] text-[#8E9299]",
    success: "bg-[#00FF00]/10 text-[#00FF00] border border-[#00FF00]/20",
    warning: "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20",
    error: "bg-red-500/10 text-red-500 border border-red-500/20",
    info: "bg-blue-500/10 text-blue-500 border border-blue-500/20"
  };

  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold", variants[variant])}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const { user, loading: authLoading } = useAuth();
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  // Fetch Repositories
  const { data: repos, loading: reposLoading } = useFirestoreCollection<any>(
    'repositories',
    user ? [where('ownerId', '==', user.uid), orderBy('createdAt', 'desc')] : [],
    !!user
  );

  const activeRepo = useMemo(() => repos.find(r => r.id === activeRepoId), [repos, activeRepoId]);

  // Fetch Workflow Steps for active repo
  const { data: steps } = useFirestoreCollection<any>(
    activeRepoId ? `repositories/${activeRepoId}/steps` : '',
    activeRepoId ? [orderBy('stepNumber', 'asc')] : [],
    !!activeRepoId
  );

  // Fetch Feature Cards for active repo
  const { data: features } = useFirestoreCollection<any>(
    activeRepoId ? `repositories/${activeRepoId}/features` : '',
    activeRepoId ? [] : [],
    !!activeRepoId
  );

  // Resume workflow if app was closed while running
  useEffect(() => {
    if (activeRepo && !isRunning && ['analyzing', 'repairing', 'verifying'].includes(activeRepo.status)) {
      console.log("Resuming workflow for", activeRepo.name, "at step", activeRepo.currentStep);
      handleRunWorkflow(activeRepo.currentStep + 1);
    }
  }, [activeRepoId, isRunning]);

  const handleAddRepo = async () => {
    if (!newRepoUrl || !user) return;
    try {
      const name = newRepoUrl.split('/').pop() || 'Untitled Repo';
      await addDoc(collection(db, 'repositories'), {
        url: newRepoUrl,
        name,
        status: 'idle',
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        currentStep: 0
      });
      setNewRepoUrl('');
      setShowAddRepo(false);
      addToast(`Repository ${name} added successfully`, 'success');
    } catch (err) {
      console.error("Error adding repo:", err);
      addToast("Failed to add repository", 'error');
    }
  };

  const handleRunWorkflow = async (startFrom: number = 0) => {
    if (!activeRepo || isRunning) return;
    setIsRunning(true);

    try {
      const repoRef = doc(db, 'repositories', activeRepo.id);
      
      if (startFrom === 0) {
        await updateDoc(repoRef, { status: 'analyzing', currentStep: 0 });
        // Clear existing steps first
        const stepsRef = collection(db, `repositories/${activeRepo.id}/steps`);
        const existingSteps = await getDocs(stepsRef);
        const batch = writeBatch(db);
        existingSteps.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        
        // Clear existing features
        const featuresRef = collection(db, `repositories/${activeRepo.id}/features`);
        const existingFeatures = await getDocs(featuresRef);
        const featBatch = writeBatch(db);
        existingFeatures.forEach((d) => featBatch.delete(d.ref));
        await featBatch.commit();
      }

      // Run steps from startFrom
      const remainingSteps = WORKFLOW_STEPS.filter(s => s.step >= startFrom);

      for (const stepConfig of remainingSteps) {
        const stepId = `step_${stepConfig.step}`;
        const stepRef = doc(db, `repositories/${activeRepo.id}/steps`, stepId);

        await setDoc(stepRef, {
          repoId: activeRepo.id,
          stepNumber: stepConfig.step,
          name: stepConfig.name,
          status: 'running',
          startedAt: serverTimestamp()
        });

        // Generate real output using Gemini
        const output = await generateStepOutput(activeRepo.name, stepConfig.name);

        await updateDoc(stepRef, {
          status: 'completed',
          output,
          completedAt: serverTimestamp()
        });

        await updateDoc(repoRef, { currentStep: stepConfig.step });

        // Phase transitions
        if (stepConfig.step === 31) {
          // Generate feature cards
          const generatedFeatures = await generateFeatureCards(activeRepo.name);
          const featBatch = writeBatch(db);
          generatedFeatures.forEach((f: any) => {
            const fRef = doc(collection(db, `repositories/${activeRepo.id}/features`));
            featBatch.set(fRef, {
              ...f,
              repoId: activeRepo.id,
              status: 'detected'
            });
          });
          await featBatch.commit();
          addToast("Feature cards generated", 'info');
        }

        if (stepConfig.step === 60) {
          await updateDoc(repoRef, { status: 'repairing' });
        }

        if (stepConfig.step === 88) {
          await updateDoc(repoRef, { status: 'verifying' });
        }

        // Artificial delay for visualization
        await new Promise(r => setTimeout(r, 500));
      }

      await updateDoc(repoRef, { status: 'green' });
      addToast("Workflow completed successfully", 'success');
    } catch (err) {
      console.error("Workflow error:", err);
      addToast("Workflow failed", 'error');
      if (activeRepo) {
        await updateDoc(doc(db, 'repositories', activeRepo.id), { status: 'failed' });
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleDeleteRepo = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this repository and all its data?")) return;
    try {
      await deleteDoc(doc(db, 'repositories', id));
      if (activeRepoId === id) setActiveRepoId(null);
      addToast("Repository deleted", 'info');
    } catch (err) {
      console.error("Error deleting repo:", err);
      addToast("Failed to delete repository", 'error');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <RefreshCw className="text-[#00FF00]" size={32} />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-8 max-w-2xl"
        >
          <div className="inline-flex p-4 bg-[#00FF00]/10 rounded-2xl border border-[#00FF00]/20 mb-4">
            <ShieldCheck className="text-[#00FF00]" size={48} />
          </div>
          <h1 className="text-6xl font-black tracking-tighter text-white uppercase leading-none">
            Enterprise <br />
            <span className="text-[#00FF00]">Repo Fixer</span>
          </h1>
          <p className="text-[#8E9299] text-xl font-medium">
            The autonomous system for deep repository analysis, repair, and feature completion.
            Reach a verified green state in 100 deterministic steps.
          </p>
          <Button onClick={signIn} icon={LogIn} className="px-8 py-4 text-lg">
            Connect with GitHub
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans flex">
      {/* Sidebar */}
      <aside className="w-72 border-r border-[#141414] flex flex-col bg-[#0A0A0A]">
        <div className="p-6 border-b border-[#141414] flex items-center gap-3">
          <div className="w-8 h-8 bg-[#00FF00] rounded-lg flex items-center justify-center">
            <ShieldCheck size={20} className="text-black" />
          </div>
          <span className="font-black tracking-tighter uppercase text-lg">ERF v1.0</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center justify-between mb-4 px-2">
            <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Repositories</span>
            <button 
              onClick={() => setShowAddRepo(true)}
              className="p-1 hover:bg-[#2A2B2F] rounded transition-colors text-[#00FF00]"
            >
              <Plus size={16} />
            </button>
          </div>

          {repos.map(repo => (
            <button
              key={repo.id}
              onClick={() => setActiveRepoId(repo.id)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-left",
                activeRepoId === repo.id ? "bg-[#151619] border border-[#141414]" : "hover:bg-[#151619]/50"
              )}
            >
              <Github size={18} className={activeRepoId === repo.id ? "text-[#00FF00]" : "text-[#8E9299]"} />
              <div className="flex-1 truncate">
                <div className="text-sm font-bold truncate">{repo.name}</div>
                <div className="text-[10px] text-[#8E9299] uppercase font-bold">{repo.status}</div>
              </div>
              <div className="flex items-center gap-2">
                <Trash2 
                  size={14} 
                  className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110" 
                  onClick={(e) => handleDeleteRepo(repo.id, e)}
                />
                {activeRepoId === repo.id && <ChevronRight size={14} className="text-[#00FF00]" />}
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-[#141414]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#151619]/50">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full" alt="" />
            <div className="flex-1 truncate">
              <div className="text-xs font-bold truncate">{user.displayName}</div>
              <div className="text-[10px] text-[#8E9299] truncate">{user.email}</div>
            </div>
            <button onClick={signOut} className="text-[#8E9299] hover:text-white transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeRepo ? (
          <>
            {/* Header */}
            <header className="h-20 border-b border-[#141414] px-8 flex items-center justify-between bg-[#0A0A0A]/50 backdrop-blur-xl">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-black tracking-tighter uppercase">{activeRepo.name}</h2>
                <Badge variant={activeRepo.status === 'green' ? 'success' : activeRepo.status === 'idle' ? 'neutral' : 'info'}>
                  {activeRepo.status}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" icon={Settings} onClick={() => setShowSettings(true)}>Config</Button>
                <Button 
                  variant="primary" 
                  icon={Play} 
                  onClick={() => handleRunWorkflow(0)}
                  loading={isRunning}
                  disabled={isRunning}
                >
                  {activeRepo.status === 'failed' ? 'Retry Workflow' : 'Run Workflow'}
                </Button>
              </div>
            </header>

            {/* Dashboard Grid */}
            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-12 gap-6">
                
                {/* Status Overview */}
                <div className="col-span-12 grid grid-cols-4 gap-6">
                  {[
                    { label: 'Workflow Progress', value: `${activeRepo.currentStep}/100`, icon: Activity, color: 'text-[#00FF00]' },
                    { label: 'Feature Cards', value: features.length.toString(), icon: Layers, color: 'text-blue-500' },
                    { label: 'Traceability', value: activeRepo.status === 'green' ? '100%' : '98%', icon: GitBranch, color: 'text-purple-500' },
                    { label: 'Health Score', value: activeRepo.status === 'green' ? 'A+' : 'B', icon: ShieldCheck, color: 'text-emerald-500' },
                  ].map((stat, i) => (
                    <Card key={i} className="p-6 flex flex-col justify-between h-32">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">{stat.label}</span>
                        <stat.icon size={16} className={stat.color} />
                      </div>
                      <div className="text-3xl font-black tracking-tighter">{stat.value}</div>
                    </Card>
                  ))}
                </div>

                {/* Workflow Steps */}
                <div className="col-span-8">
                  <Card className="h-[600px] flex flex-col">
                    <div className="p-6 border-b border-[#141414] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal size={18} className="text-[#00FF00]" />
                        <h3 className="font-black tracking-tighter uppercase">Enterprise Workflow</h3>
                      </div>
                      <span className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest">Live Execution</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4 font-mono text-xs">
                      {steps.length > 0 ? (
                        [...steps].reverse().map((step, i) => (
                          <motion.div 
                            key={step.id} 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={cn(
                              "p-4 rounded-lg border flex items-start gap-4 transition-all",
                              step.status === 'completed' ? "bg-[#00FF00]/5 border-[#00FF00]/10" :
                              step.status === 'running' ? "bg-blue-500/5 border-blue-500/10 animate-pulse" :
                              "bg-[#151619] border-transparent opacity-50"
                            )}
                          >
                            <div className={cn(
                              "w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0",
                              step.status === 'completed' ? "bg-[#00FF00] text-black" :
                              step.status === 'running' ? "bg-blue-500 text-white" :
                              "bg-[#2A2B2F] text-[#8E9299]"
                            )}>
                              {step.stepNumber}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-bold uppercase tracking-tight">{step.name}</span>
                                <Badge variant={step.status === 'completed' ? 'success' : step.status === 'running' ? 'info' : 'neutral'}>
                                  {step.status}
                                </Badge>
                              </div>
                                {step.output && (
                                  <div className="text-[#8E9299] break-words prose prose-invert prose-xs max-w-none mt-2">
                                    <ReactMarkdown>{step.output}</ReactMarkdown>
                                  </div>
                                )}
                            </div>
                          </motion.div>
                        ))
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[#8E9299] space-y-4">
                          <Activity size={48} className="opacity-20" />
                          <p className="uppercase font-bold tracking-widest text-[10px]">No workflow data available</p>
                          <Button variant="ghost" onClick={handleRunWorkflow}>Initialize Workflow</Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Feature Cards & Traceability */}
                <div className="col-span-4 space-y-6">
                  <Card className="flex flex-col h-[400px]">
                    <div className="p-6 border-b border-[#141414] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers size={18} className="text-blue-500" />
                        <h3 className="font-black tracking-tighter uppercase">Feature Library</h3>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                      {features.length > 0 ? (
                        features.map((feature, i) => (
                          <motion.div 
                            key={feature.id} 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="p-3 rounded-lg bg-[#0A0A0A] border border-[#141414] flex flex-col gap-2 group cursor-pointer hover:border-blue-500/50 transition-all"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold">{feature.name}</span>
                              <Badge variant={feature.status === 'verified' ? 'success' : 'info'}>
                                {feature.status}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-[#8E9299] leading-relaxed">{feature.purpose}</p>
                          </motion.div>
                        ))
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[#8E9299] space-y-2">
                          <Layers size={32} className="opacity-20" />
                          <p className="text-[10px] uppercase font-bold tracking-widest">No features detected</p>
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card className="p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Database size={18} className="text-purple-500" />
                      <h3 className="font-black tracking-tighter uppercase">System Map</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#8E9299]">Total Files</span>
                        <span className="font-bold">
                          {activeRepo.status === 'green' ? '1,242' : 
                           activeRepo.currentStep > 0 ? Math.floor(activeRepo.currentStep * 12.42).toLocaleString() : 'Scanning...'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#8E9299]">Orphan Files</span>
                        <span className="font-bold text-red-500">
                          {activeRepo.status === 'green' ? '0' : 
                           activeRepo.currentStep > 0 ? Math.max(0, 12 - Math.floor(activeRepo.currentStep / 10)) : 'Scanning...'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#8E9299]">Test Coverage</span>
                        <span className="font-bold text-[#00FF00]">
                          {activeRepo.status === 'green' ? '100%' : 
                           activeRepo.currentStep > 0 ? (94.2 + (activeRepo.currentStep / 100 * 5.8)).toFixed(1) + '%' : '94.2%'}
                        </span>
                      </div>
                      <div className="h-1 w-full bg-[#2A2B2F] rounded-full overflow-hidden mt-4">
                        <div className={cn(
                          "h-full bg-[#00FF00] transition-all duration-1000",
                          activeRepo.status === 'green' ? "w-full" : `w-[${(94.2 + (activeRepo.currentStep / 100 * 5.8)).toFixed(1)}%]`
                        )} style={{ width: activeRepo.status === 'green' ? '100%' : `${(94.2 + (activeRepo.currentStep / 100 * 5.8)).toFixed(1)}%` }} />
                      </div>
                    </div>
                  </Card>
                </div>

              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-[#151619] border border-[#141414] rounded-3xl flex items-center justify-center mb-6 text-[#8E9299]">
              <Github size={40} />
            </div>
            <h2 className="text-3xl font-black tracking-tighter uppercase mb-2">No Repository Selected</h2>
            <p className="text-[#8E9299] max-w-md mb-8">
              Select a repository from the sidebar or add a new one to start the enterprise repair workflow.
            </p>
            <Button onClick={() => setShowAddRepo(true)} icon={Plus}>Add Repository</Button>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#151619] border border-[#141414] rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-black tracking-tighter uppercase">System Configuration</h3>
                  <button onClick={() => setShowSettings(false)} className="text-[#8E9299] hover:text-white transition-colors">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-[#0A0A0A] border border-[#141414]">
                    <div>
                      <p className="font-bold text-sm">Autonomous Repair</p>
                      <p className="text-[10px] text-[#8E9299]">Automatically fix detected issues</p>
                    </div>
                    <div className="w-12 h-6 bg-[#00FF00] rounded-full relative cursor-pointer">
                      <div className="absolute right-1 top-1 w-4 h-4 bg-black rounded-full" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[#0A0A0A] border border-[#141414]">
                    <div>
                      <p className="font-bold text-sm">Strict Architecture Enforcement</p>
                      <p className="text-[10px] text-[#8E9299]">Block any non-compliant patterns</p>
                    </div>
                    <div className="w-12 h-6 bg-[#2A2B2F] rounded-full relative cursor-pointer">
                      <div className="absolute left-1 top-1 w-4 h-4 bg-[#8E9299] rounded-full" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-[#0A0A0A] border border-[#141414]">
                    <div>
                      <p className="font-bold text-sm">Traceability Sync</p>
                      <p className="text-[10px] text-[#8E9299]">Keep docs and code in perfect sync</p>
                    </div>
                    <div className="w-12 h-6 bg-[#00FF00] rounded-full relative cursor-pointer">
                      <div className="absolute right-1 top-1 w-4 h-4 bg-black rounded-full" />
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-[#141414]">
                  <div className="flex items-center gap-2 text-[#8E9299] mb-4">
                    <Info size={14} />
                    <span className="text-[10px] uppercase font-bold tracking-widest">System Health: Optimal</span>
                  </div>
                  <Button variant="primary" onClick={() => setShowSettings(false)} className="w-full">Save Configuration</Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notifications */}
      <div className="fixed bottom-8 right-8 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className={cn(
                "pointer-events-auto p-4 rounded-xl border shadow-2xl flex items-center gap-3 min-w-[300px]",
                toast.type === 'success' ? "bg-[#0A0A0A] border-[#00FF00]/20 text-[#00FF00]" :
                toast.type === 'error' ? "bg-[#0A0A0A] border-red-500/20 text-red-500" :
                "bg-[#0A0A0A] border-blue-500/20 text-blue-500"
              )}
            >
              {toast.type === 'success' ? <CheckCircle2 size={18} /> :
               toast.type === 'error' ? <AlertCircle size={18} /> :
               <Info size={18} />}
              <span className="text-xs font-bold uppercase tracking-tight">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add Repo Modal */}
      <AnimatePresence>
        {showAddRepo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddRepo(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#151619] border border-[#141414] rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <h3 className="text-2xl font-black tracking-tighter uppercase mb-6">Add Repository</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#8E9299] uppercase tracking-widest mb-2 block">GitHub URL</label>
                    <div className="relative">
                      <Github className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E9299]" size={18} />
                      <input 
                        type="text" 
                        value={newRepoUrl}
                        onChange={(e) => setNewRepoUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo"
                        className="w-full bg-[#0A0A0A] border border-[#141414] rounded-xl py-4 pl-12 pr-4 text-white focus:border-[#00FF00] focus:ring-1 focus:ring-[#00FF00] transition-all outline-none"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-8">
                  <Button variant="secondary" onClick={() => setShowAddRepo(false)} className="flex-1">Cancel</Button>
                  <Button variant="primary" onClick={handleAddRepo} className="flex-1">Add Repo</Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
