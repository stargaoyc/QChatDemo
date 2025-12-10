
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2, KeyRound, X, Check, AlertCircle } from 'lucide-react';
import { storageService } from '../services/storageService';
import { AppSettings } from '../types';
import { socketService } from '../services/socketService';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
    const [settings, setSettings] = useState<AppSettings>({ theme: 'light', notificationsEnabled: true, logLevel: 'info' });
  const [saved, setSaved] = useState(false);
    const [showChangePwd, setShowChangePwd] = useState(false);
    const [newPwd, setNewPwd] = useState('');
    const [confirmPwd, setConfirmPwd] = useState('');
    const [pwdError, setPwdError] = useState<string | null>(null);
    const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    storageService.getSettings().then(setSettings);
  }, []);

  const handleSave = async () => {
    await storageService.saveSettings(settings);
    
    // Apply theme only on save
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearData = async () => {
      if(confirm('确定吗？这将删除本账号的本地聊天记录（消息与会话），但会保留账号信息和好友列表。')) {
          await storageService.clearAll();
          window.location.reload();
      }
  }

  const handleChangePassword = async () => {
      setPwdError(null);
      if (!newPwd.trim() || !confirmPwd.trim()) {
          setPwdError('请输入新密码并确认');
          return;
      }
      if (newPwd.trim() !== confirmPwd.trim()) {
          setPwdError('两次输入的密码不一致');
          return;
      }
      setPwdLoading(true);
      const result = await socketService.changePassword(newPwd.trim());
      setPwdLoading(false);
      if (!result.success) {
          const msg = result.reason === 'DISCONNECTED' ? '当前未连接，无法修改密码' : result.reason === 'TIMEOUT' ? '请求超时，请稍后重试' : '修改失败，请稍后重试';
          setPwdError(msg);
          return;
      }
      alert('密码修改成功，请重新登录');
      await storageService.logout();
      socketService.disconnect();
      navigate('/');
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col transition-colors duration-200">
       <header className="bg-white dark:bg-slate-800 shadow-sm border-b border-slate-200 dark:border-slate-700 h-16 flex items-center px-4 gap-4 draggable transition-colors duration-200">
           <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors no-drag">
               <ArrowLeft size={20} className="text-slate-600 dark:text-slate-400" />
           </button>
           <h1 className="text-lg font-bold text-slate-800 dark:text-white">设置</h1>
       </header>

       <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
           <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-200">
               
               {/* Appearance */}
               <div className="p-6 border-b border-slate-100 dark:border-slate-700">
                   <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide mb-4">外观</h3>
                   <div className="flex items-center justify-between">
                       <span className="text-slate-600 dark:text-slate-300 text-sm">主题</span>
                       <select 
                        value={settings.theme}
                        onChange={e => setSettings({...settings, theme: e.target.value as any})}
                        className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-100 dark:text-white"
                       >
                           <option value="light">浅色</option>
                           <option value="dark">深色</option>
                       </select>
                   </div>
               </div>

               {/* Debugging */}
               <div className="p-6 border-b border-slate-100 dark:border-slate-700">
                   <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide mb-4">高级</h3>
                   <div className="flex items-center justify-between mb-4">
                       <span className="text-slate-600 dark:text-slate-300 text-sm">日志等级</span>
                       <select 
                        value={settings.logLevel}
                        onChange={e => setSettings({...settings, logLevel: e.target.value as any})}
                        className="bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-100 dark:text-white"
                       >
                           <option value="info">信息 (Info)</option>
                           <option value="warn">警告 (Warn)</option>
                           <option value="error">错误 (Error)</option>
                       </select>
                   </div>

                                        <div className="flex items-center justify-between mb-4">
                                                <span className="text-slate-600 dark:text-slate-300 text-sm">修改密码</span>
                                                <button
                                                    onClick={() => { setShowChangePwd(true); setNewPwd(''); setConfirmPwd(''); setPwdError(null); }}
                                                    className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white rounded-md hover:bg-slate-200 dark:hover:bg-slate-600"
                                                >
                                                    <KeyRound size={16} /> 修改
                                                </button>
                                        </div>
                   
                   <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                        <button onClick={clearData} className="flex items-center gap-2 text-red-600 text-sm hover:underline">
                            <Trash2 size={16} /> 清除本地聊天数据
                        </button>
                   </div>
               </div>

               <div className="p-6 bg-slate-50 dark:bg-slate-900 flex justify-end transition-colors duration-200">
                   <button 
                    onClick={handleSave}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                   >
                       <Save size={18} /> {saved ? '已保存!' : '保存更改'}
                   </button>
               </div>
           </div>
       </div>

       {showChangePwd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 relative animate-in fade-in zoom-in duration-200 transition-colors duration-200">
                <button 
                    onClick={() => { setShowChangePwd(false); setPwdError(null); }} 
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className="bg-indigo-100 dark:bg-indigo-900/30 p-2 rounded-lg text-indigo-600 dark:text-indigo-400">
                        <KeyRound size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">修改密码</h3>
                </div>

                {pwdError && (
                    <div className="mb-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-3 py-2 rounded text-sm flex items-center gap-2">
                        <AlertCircle size={14} /> {pwdError}
                    </div>
                )}

                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">新密码</label>
                        <input 
                            type="password"
                            value={newPwd}
                            onChange={(e) => setNewPwd(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">确认新密码</label>
                        <input 
                            type="password"
                            value={confirmPwd}
                            onChange={(e) => setConfirmPwd(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all"
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <button
                        onClick={() => { setShowChangePwd(false); setPwdError(null); }}
                        className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1"
                    >
                        <X size={14} /> 取消
                    </button>
                    <button
                        onClick={handleChangePassword}
                        disabled={pwdLoading}
                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 disabled:opacity-60"
                    >
                        <Check size={14} /> {pwdLoading ? '提交中...' : '确认'}
                    </button>
                </div>
            </div>
        </div>
       )}
    </div>
  );
};

export default SettingsPage;