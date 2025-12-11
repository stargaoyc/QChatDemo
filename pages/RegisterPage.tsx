import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { socketService } from '../services/socketService';
import { storageService } from '../services/storageService';

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [serverHost, setServerHost] = useState('');
  const [serverPort, setServerPort] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      setUserId('');
      const settings = await storageService.getSettings();
      if (settings.serverHost) setServerHost(settings.serverHost);
      if (settings.serverPort) setServerPort(String(settings.serverPort));
    };
    init();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedId = userId.trim();
    const trimmedPwd = password.trim();
    const trimmedConfirm = confirmPassword.trim();
    const hostTrim = serverHost.trim();
    const portTrim = serverPort.trim();

    if (!trimmedId || !trimmedPwd || !trimmedConfirm) {
      setError('请完整填写所有字段');
      return;
    }

    if (trimmedPwd !== trimmedConfirm) {
      setError('两次输入的密码不一致');
      return;
    }

    const hostRegex = /^((25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3})$|^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$|^localhost$/;
    if (hostTrim && !hostRegex.test(hostTrim)) {
      setError('服务器地址格式错误，请输入有效的 IPv4 或域名');
      return;
    }
    if (portTrim) {
      const portNum = Number(portTrim);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setError('端口号需为 1-65535 的整数');
        return;
      }
    }

    setLoading(true);

    try {
      const prev = await storageService.getSettings();
      const next: any = { ...prev };
      if (hostTrim) next.serverHost = hostTrim; else delete next.serverHost;
      if (portTrim) next.serverPort = Number(portTrim); else delete next.serverPort;
      await storageService.saveSettings(next);

      socketService.configureServer(hostTrim || undefined, portTrim || undefined);

      const result = await socketService.register(trimmedId, trimmedPwd);

      if (!result.success) {
        const reason =
          result.reason === 'USER_EXISTS'
            ? '该用户已注册'
            : result.reason === 'CONNECTION_FAILED'
              ? '服务器连接失败，请检查网络或确认服务端已启动'
              : '注册失败，请稍后重试';
        setError(reason);
        return;
      }

      setSuccess('注册成功，请返回登录');
      setTimeout(() => navigate('/'), 1200);
    } catch (e) {
      console.error('Register failed', e);
      setError('注册过程中出现异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4 transition-colors duration-200">
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-xl overflow-hidden transition-colors duration-200">
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div className="bg-indigo-50 dark:bg-indigo-900/30 p-3 rounded-full">
                    <ShieldCheck size={32} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <ArrowLeft size={16} /> 返回登录
                </button>
            </div>
            <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-white mb-2">注册新账号</h2>
            <p className="text-center text-slate-500 dark:text-slate-400 mb-8 text-sm">创建账号以使用 QChat 安全聊天。</p>
            
            {error && (
                <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}
            {success && (
                <div className="mb-4 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    {success}
                </div>
            )}
            
            <form onSubmit={handleRegister} className="space-y-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">用户 ID</label>
                    <input 
                        type="text" 
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        placeholder="例如: user_123"
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all text-slate-700 font-mono"
                        required
                    />
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">密码</label>
                    <input 
                        type="password" 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="请输入密码"
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all text-slate-700"
                        required
                    />
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">确认密码</label>
                    <input 
                        type="password" 
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="请再次输入密码"
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all text-slate-700"
                        required
                    />
                </div>

                <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">信令服务器地址(留空则搜索本地或预设)</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="text"
                      value={serverHost}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const trimmed = raw.trim();
                        const hostPortMatch = trimmed.match(/^([a-zA-Z0-9.-]+):(\d{0,5})$/);
                        if (hostPortMatch) {
                          setServerHost(hostPortMatch[1].replace(/[^a-zA-Z0-9.-]/g, ''));
                          setServerPort(hostPortMatch[2]);
                        } else {
                          setServerHost(trimmed.replace(/[^a-zA-Z0-9.-]/g, ''));
                        }
                      }}
                      placeholder={serverHost.trim()==='' ? 'IP 或 域名' : ''}
                      className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all font-mono"
                    />
                    <span className="text-slate-400">:</span>
                    <input 
                      type="text"
                      value={serverPort}
                      onChange={(e) => setServerPort(e.target.value.replace(/\D/g, ''))}
                      placeholder={serverPort.trim()==='' ? '端口号' : ''}
                      className="w-28 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all font-mono"
                    />
                  </div>
                </div>

                <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {loading ? '正在注册...' : '注册'}
                </button>
            </form>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 px-8 py-4 border-t border-slate-100 dark:border-slate-700 text-center text-xs text-slate-400 dark:text-slate-500 transition-colors duration-200">
            已有账号？ <button onClick={() => navigate('/')} className="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold">返回登录</button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
