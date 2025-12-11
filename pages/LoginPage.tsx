import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { socketService } from "../services/socketService";
import { storageService } from "../services/storageService";
import { ShieldCheck, ArrowRight, Loader2, AlertCircle, UserPlus } from "lucide-react";

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("");
  const navigate = useNavigate();
  const authResolvedRef = useRef(false);

  useEffect(() => {
    // Auto-fill last user
    const loadLastUser = async () => {
      const lastUser = await storageService.getLastUser();
      if (lastUser) {
        setUserId(lastUser.id);
      } else {
        // Default if no history
        setUserId(`user_${Math.floor(Math.random() * 1000)}`);
      }
      // Prefill server config from settings if any
      const settings = await storageService.getSettings();
      if (settings.serverHost) setServerHost(settings.serverHost);
      if (settings.serverPort) setServerPort(String(settings.serverPort));
    };
    loadLastUser();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !password.trim()) {
      setError("请输入用户 ID 和密码");
      return;
    }

    setLoading(true);
    setError(null);
    authResolvedRef.current = false;
    // Validate Host (IPv4 or Domain) and port if provided
    const hostTrim = serverHost.trim();
    const portTrim = serverPort.trim();
    // Regex for IPv4 or Domain Name (including localhost)
    const hostRegex =
      /^((25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3})$|^((?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,63}$|^localhost$/;

    if (hostTrim && !hostRegex.test(hostTrim)) {
      setLoading(false);
      setError("服务器地址格式错误，请输入有效的 IPv4 或域名");
      return;
    }
    if (portTrim) {
      const portNum = Number(portTrim);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setLoading(false);
        setError("端口号需为 1-65535 的整数");
        return;
      }
    }

    // Create / restore User Object
    const baseId = userId.trim();

    // Prefer per-user profile (supports multiple accounts each remembering their own nickname)
    const existingProfile = await storageService.getUserProfile(baseId);

    const user = {
      id: baseId,
      username: existingProfile?.username || baseId,
      status: "online" as const,
      avatarUrl:
        existingProfile?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${baseId}`,
    };

    // Save Session
    await storageService.setCurrentUser(user);

    // Configure server and persist (IPv4 only)
    if (hostTrim || portTrim) {
      socketService.configureServer(hostTrim || undefined, portTrim || undefined);
      const prev = await storageService.getSettings();
      const next = { ...prev, serverHost: hostTrim || undefined } as any;
      if (portTrim) next.serverPort = Number(portTrim);
      await storageService.saveSettings(next);
    } else {
      // Clear to use env/defaults
      socketService.configureServer();
    }

    // Attempt Connection
    let offAuth: () => void = () => {};
    let offConn: () => void = () => {};
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      offAuth();
      offConn();
      clearTimeout(timeoutId);
    };

    socketService.connect(user, password.trim());

    offAuth = socketService.onAuthResult((result) => {
      console.log(
        "[LoginPage] onAuthResult callback triggered:",
        result,
        "authResolvedRef:",
        authResolvedRef.current,
      );
      if (authResolvedRef.current) return;
      authResolvedRef.current = true;
      if (result.success) {
        console.log("[LoginPage] Auth success, navigating to /app");
        setLoading(false);
        navigate("/app");
      } else {
        console.log("[LoginPage] Auth failed:", result.reason);
        setLoading(false);
        const reason =
          result.reason === "NOT_REGISTERED"
            ? "账号未注册，请先注册"
            : result.reason === "BAD_PASSWORD"
              ? "密码错误"
              : "鉴权失败";
        setError(reason);
        socketService.disconnect();
      }
      cleanup();
    });

    // Track if we've ever been connected or connecting
    let hasStartedConnecting = false;

    offConn = socketService.onConnectionChange((state) => {
      console.log(
        "[LoginPage] onConnectionChange callback:",
        state,
        "authResolvedRef:",
        authResolvedRef.current,
        "hasStartedConnecting:",
        hasStartedConnecting,
      );
      if (authResolvedRef.current) return;

      // Mark that we've started connecting
      if (state === "CONNECTING" || state === "CONNECTED") {
        hasStartedConnecting = true;
      }

      if (state === "RECONNECTING") {
        // Inform user we're retrying automatically
        setLoading(true);
        setError("连接中断，正在自动重试...");
        return;
      }
      if (state === "DISCONNECTED") {
        // Only show error if we had actually started connecting
        // (ignore the initial DISCONNECTED state when registering the callback)
        if (hasStartedConnecting) {
          console.log("[LoginPage] State is DISCONNECTED after connecting, showing error");
          setLoading(false);
          setError("连接服务器失败，请检查网络或确认服务端已启动。");
          cleanup();
        }
      }
    });

    timeoutId = setTimeout(() => {
      if (authResolvedRef.current) return;
      authResolvedRef.current = true;
      setLoading(false);
      setError("连接或鉴权超时，请稍后重试");
      socketService.disconnect();
      cleanup();
    }, 20000);
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-4 transition-colors duration-200">
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-2xl shadow-xl overflow-hidden transition-colors duration-200">
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-3 rounded-full">
              <ShieldCheck size={40} className="text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-800 dark:text-white mb-2">
            欢迎回来
          </h2>
          <p className="text-center text-slate-500 dark:text-slate-400 mb-8 text-sm">
            专为专业人士打造的安全通讯工具。
          </p>

          {error && (
            <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                用户 ID (唯一标识)
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="例如: user_001, alice"
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all text-slate-700 font-mono"
                required
              />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                好友需要通过此 ID 添加你。
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all text-slate-700"
                required
              />
            </div>

            {/* Signaling Server Address (last section, IPv4 or Domain) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                信令服务器地址(留空则搜索本地或预设)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={serverHost}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // Allow typing 'Host:port' then split if valid shape
                    const trimmed = raw.trim();
                    const hostPortMatch = trimmed.match(/^([a-zA-Z0-9.-]+):(\d{0,5})$/);
                    if (hostPortMatch) {
                      setServerHost(hostPortMatch[1].replace(/[^a-zA-Z0-9.-]/g, ""));
                      setServerPort(hostPortMatch[2]);
                    } else {
                      // Keep only valid domain/IP chars
                      setServerHost(trimmed.replace(/[^a-zA-Z0-9.-]/g, ""));
                    }
                  }}
                  placeholder={serverHost.trim() === "" ? "IP 或 域名" : ""}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all font-mono"
                />
                <span className="text-slate-400">:</span>
                <input
                  type="text"
                  value={serverPort}
                  onChange={(e) => {
                    // Only digits for port
                    setServerPort(e.target.value.replace(/\D/g, ""));
                  }}
                  placeholder={serverPort.trim() === "" ? "端口号" : ""}
                  className="w-28 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900 focus:border-indigo-500 outline-none transition-all font-mono"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <>
                  登录 <ArrowRight size={20} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate("/register")}
              className="w-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-600"
            >
              <UserPlus size={18} /> 注册新账号
            </button>
          </form>

          {(loading || error) && (
            <div className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 text-center">
              当前尝试连接: {socketService.getUrl() || "（默认）"}
            </div>
          )}
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 px-8 py-4 border-t border-slate-100 dark:border-slate-700 text-center text-xs text-slate-400 dark:text-slate-500 transition-colors duration-200">
          当前版本: v0.1.0
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
