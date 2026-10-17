'use strict';
// Chinese source messages, English and Japanese translations. Shared by renderer and main.
(function(root){
  const messages = {
  "AGENTS.md 与相关规则": [
    "AGENTS.md and related rules",
    "AGENTS.md と関連規約"
  ],
  "AgentKit 接入说明 ↗": [
    "AgentKit guide ↗",
    "AgentKit 接続ガイド ↗"
  ],
  "Responses API 工具配置示例": [
    "Responses API tool configuration example",
    "Responses API ツール設定例"
  ],
  "Responses API 接入说明 ↗": [
    "Responses API guide ↗",
    "Responses API 接続ガイド ↗"
  ],
  "Responses API 的 MCP 工具声明": [
    "MCP tool definition for Responses API",
    "Responses API の MCP ツール定義"
  ],
  "Runtime API Key 无效或已失效，请重新填写后连接。": [
    "The Runtime API Key is invalid or expired. Enter it again and reconnect.",
    "Runtime API Key が無効か期限切れです。再入力して接続してください。"
  ],
  "Runtime API Key 格式无效，请粘贴一行完整密钥。": [
    "Invalid Runtime API Key format. Paste the complete key on one line.",
    "Runtime API Key の形式が無効です。完全なキーを1行で貼り付けてください。"
  ],
  "Tunnel ID 应为 tunnel_ 后跟 32 位小写字母或数字。": [
    "The Tunnel ID must be tunnel_ followed by 32 lowercase letters or digits.",
    "Tunnel ID は tunnel_ に続く32文字の小文字英数字です。"
  ],
  "Tunnel ID 格式无效，应为 tunnel_ 加 32 位小写字母或数字。": [
    "Invalid Tunnel ID. Use tunnel_ followed by 32 lowercase letters or digits.",
    "Tunnel ID が無効です。tunnel_ に続く32文字の小文字英数字を入力してください。"
  ],
  "tunnel_替换为已配置的通道标识": [
    "tunnel_replace_with_your_configured_id",
    "tunnel_設定済みのIDに置換"
  ],
  "为这个工作空间建立一条安全通道。": [
    "Create a secure connection to this workspace.",
    "このワークスペースへの安全な接続を設定します。"
  ],
  "从连接到第一次调用": [
    "From connection to your first tool call",
    "接続から最初のツール呼び出しまで"
  ],
  "以下接入方式有官方支持，实际可用性取决于账号权限与客户端配置。": [
    "These clients have official support. Availability depends on account permissions and client setup.",
    "以下は公式に対応する接続方法です。利用可否はアカウント権限とクライアント設定によります。"
  ],
  "你的工作空间，由你掌控。": [
    "Your workspace. In your control.",
    "自分のワークスペースを、自分の手で。"
  ],
  "使用为这个工作空间创建的通道与运行密钥。": [
    "Use the tunnel and runtime key created for this workspace.",
    "このワークスペース用のトンネルと実行用キーを使用します。"
  ],
  "使用后台图标恢复窗口；选择「退出 ChatToHarness」才会停止受管进程。": [
    "Use the background icon to reopen the window. Quit ChatToHarness to stop managed processes.",
    "バックグラウンドアイコンで画面を開けます。管理対象プロセスは「ChatToHarness を終了」で停止します。"
  ],
  "使用提示与故障处理": [
    "Tips and troubleshooting",
    "使い方とトラブル対処"
  ],
  "使用账号所支持的 Tunnel 接入入口。确认通道所属组织与客户端账号具有访问权限。": [
    "Use your account's supported Tunnel connection flow. Check organization and client access permissions.",
    "アカウントで利用可能な Tunnel 接続機能を使い、所属組織とクライアントのアクセス権を確認してください。"
  ],
  "保存 Tunnel ID 后显示": [
    "Shown after saving a Tunnel ID",
    "Tunnel ID の保存後に表示"
  ],
  "保存工作目录设置": [
    "Save workspace settings",
    "作業フォルダー設定を保存"
  ],
  "保存并连接": [
    "Save and connect",
    "保存して接続"
  ],
  "保存并连接前，请在「工作目录」中至少选择一个目录。Runtime API Key 仅用于运行通道，不能代替客户端或 API 调用方的凭据。": [
    "Select at least one work directory before connecting. The Runtime API Key runs the tunnel; clients and API callers need their own credentials.",
    "接続前に作業フォルダーを1つ以上選んでください。Runtime API Key はトンネル実行用です。クライアントや API 呼び出し側の認証情報とは別です。"
  ],
  "停止连接": [
    "Stop connection",
    "接続を停止"
  ],
  "允许文件工具访问的目录": [
    "Directories accessible to file tools",
    "ファイルツールがアクセスできるフォルダー"
  ],
  "全选": [
    "Select all",
    "すべて選択"
  ],
  "关闭窗口后仍然运行": [
    "Keep running after closing the window",
    "ウィンドウを閉じても実行を継続"
  ],
  "关闭窗口后继续后台运行；不会随系统登录启动。": [
    "Keep running when the window closes. Starting at system login is disabled.",
    "画面を閉じてもバックグラウンドで動作します。ログイン時の自動起動は無効です。"
  ],
  "准备连接你的工作空间": [
    "Connect your workspace",
    "ワークスペースを接続しましょう"
  ],
  "剪切": [
    "Cut",
    "切り取り"
  ],
  "受管进程组件缺失，请重新安装应用。": [
    "The managed-process component is missing. Reinstall the application.",
    "プロセス管理コンポーネントがありません。アプリを再インストールしてください。"
  ],
  "后台图标无法读取。": [
    "The background icon could not be loaded.",
    "バックグラウンドアイコンを読み込めません。"
  ],
  "启动路径格式无效。": [
    "Invalid launch path.",
    "起動パスが無効です。"
  ],
  "在客户端完成接入": [
    "Finish client setup",
    "クライアントの接続を完了"
  ],
  "在支持的工作区添加自定义 MCP，选择与本应用相同的 Tunnel，再确认工具权限。": [
    "Add a custom MCP in a supported workspace, choose the same Tunnel, and confirm tool permissions.",
    "対応するワークスペースでカスタム MCP を追加し、同じ Tunnel を選んでツール権限を確認します。"
  ],
  "填写后保存": [
    "Enter details to save",
    "入力後に保存してください"
  ],
  "复制": [
    "Copy",
    "コピー"
  ],
  "安全通道": [
    "Secure tunnel",
    "安全なトンネル"
  ],
  "安全通道配置": [
    "Secure tunnel settings",
    "安全なトンネルの設定"
  ],
  "官方支持": [
    "Official support",
    "公式対応"
  ],
  "客户端": [
    "Client",
    "クライアント"
  ],
  "客户端接入时选择同一个 Tunnel。": [
    "Choose the same Tunnel in your client.",
    "クライアントでも同じ Tunnel を選んでください。"
  ],
  "客户端通过安全通道调用本机工具": [
    "Client calls local tools through a secure tunnel",
    "安全なトンネルを介してローカルツールを呼び出す"
  ],
  "对话，连接本机工具": [
    "Connect chat to local tools",
    "チャットからローカルツールへ"
  ],
  "将 AI 对话连接到本机执行环境。": [
    "Connect AI chat to your local harness.",
    "AI チャットをローカルの実行環境へ。"
  ],
  "将此声明加入请求的 tools 数组。API 调用凭据由调用方管理，不使用 Runtime API Key。": [
    "Add this definition to the request's tools array. The caller manages API credentials separately from the Runtime API Key.",
    "この定義をリクエストの tools 配列に追加します。API 認証情報は呼び出し側で管理し、Runtime API Key は使用しません。"
  ],
  "尚未选择": [
    "Not selected",
    "未選択"
  ],
  "尚未配置": [
    "Not configured",
    "未設定"
  ],
  "工作目录": [
    "Work directories",
    "作業フォルダー"
  ],
  "工作目录与工程规范设置已保存。": [
    "Work directories and project instruction settings saved.",
    "作業フォルダーとプロジェクト規約の設定を保存しました。"
  ],
  "工作空间已准备就绪": [
    "Your workspace is ready",
    "ワークスペースの準備ができました"
  ],
  "工作空间暂未连接": [
    "Your workspace is disconnected",
    "ワークスペースは未接続です"
  ],
  "工作空间概览": [
    "Workspace overview",
    "ワークスペースの概要"
  ],
  "工具引擎": [
    "Tool engine",
    "ツールエンジン"
  ],
  "工具调用前不自动提供工程规范": [
    "Project instructions are not loaded automatically",
    "プロジェクト規約の自動読み込みは無効です"
  ],
  "工程规范": [
    "Project instructions",
    "プロジェクト規約"
  ],
  "工程规范设置无效。": [
    "Invalid project instruction setting.",
    "プロジェクト規約の設定が無効です。"
  ],
  "已保存的文件夹路径格式无效。": [
    "A saved directory path is invalid.",
    "保存済みフォルダーパスの形式が無効です。"
  ],
  "已保存；输入新密钥可替换": [
    "Saved; enter a new key to replace",
    "保存済み・新しいキーで置換できます"
  ],
  "已停止": [
    "Stopped",
    "停止中"
  ],
  "已关闭": [
    "Off",
    "無効"
  ],
  "已复制通道标识。": [
    "Tunnel ID copied.",
    "Tunnel ID をコピーしました。"
  ],
  "已安全保存": [
    "Securely saved",
    "安全に保存済み"
  ],
  "已清除通道标识与密钥，工作目录设置已保留。": [
    "Tunnel ID and key cleared. Work directories were retained.",
    "Tunnel ID とキーを削除しました。作業フォルダー設定は保持しています。"
  ],
  "应用导航": [
    "Application navigation",
    "アプリのナビゲーション"
  ],
  "应用正在退出。": [
    "The application is quitting.",
    "アプリを終了しています。"
  ],
  "应用组件不完整，请重新安装应用，或使用一键启动入口准备组件。": [
    "Application components are missing. Reinstall or prepare components with the one-click launcher.",
    "アプリのコンポーネントが不足しています。再インストールするか、ワンクリック起動で準備してください。"
  ],
  "应用组件或配置无法读取。请重新安装应用，或通过一键启动入口重新准备组件。": [
    "Cannot read application components or settings. Reinstall or prepare components again with the one-click launcher.",
    "コンポーネントまたは設定を読み込めません。再インストールするか、ワンクリック起動で再準備してください。"
  ],
  "应用组件未正确载入，请退出后重新打开 ChatToHarness。": [
    "Application components did not load. Quit and reopen ChatToHarness.",
    "コンポーネントを読み込めませんでした。ChatToHarness を終了して開き直してください。"
  ],
  "应用配置无法读取。": [
    "Cannot read application settings.",
    "アプリ設定を読み込めません。"
  ],
  "建立安全通道": [
    "Establish secure tunnel",
    "安全なトンネルを確立"
  ],
  "开发者接入": [
    "Developer access",
    "開発者向け接続"
  ],
  "当前通道标识": [
    "Current Tunnel ID",
    "現在の Tunnel ID"
  ],
  "当前通道标识（供客户端配置时使用）": [
    "Current Tunnel ID (for client setup)",
    "現在の Tunnel ID（クライアント設定用）"
  ],
  "打开 ChatGPT": [
    "Open ChatGPT",
    "ChatGPT を開く"
  ],
  "打开应用时自动连接": [
    "Connect automatically when opening the app",
    "アプリを開いたときに自動接続"
  ],
  "打开窗口": [
    "Open window",
    "ウィンドウを開く"
  ],
  "执行工具": [
    "Run tools",
    "ツールを実行"
  ],
  "找不到这个 Tunnel，请检查 Tunnel ID、所属组织和工作区关联。": [
    "Tunnel not found. Check the Tunnel ID, organization, and workspace association.",
    "Tunnel が見つかりません。ID、所属組織、ワークスペースとの関連付けを確認してください。"
  ],
  "接入与帮助": [
    "Connect and help",
    "接続とヘルプ"
  ],
  "接入说明 ↗": [
    "Connection guide ↗",
    "接続ガイド ↗"
  ],
  "控制台": [
    "Console",
    "コンソール"
  ],
  "控制台页面": [
    "Console pages",
    "コンソールのページ"
  ],
  "推荐开启": [
    "Recommended",
    "推奨"
  ],
  "撤销": [
    "Undo",
    "取り消す"
  ],
  "操作工程前提供适用的 AGENTS.md 和规则索引，由客户端按任务读取相关正文。": [
    "Provide applicable AGENTS.md and a rules index before operations. The client reads relevant rules for the task.",
    "操作前に AGENTS.md と規約一覧を提供します。クライアントがタスクに関連する本文を読み込みます。"
  ],
  "操作已停止。": [
    "Operation stopped.",
    "操作を停止しました。"
  ],
  "操作未完成，请重试。": [
    "Operation did not complete. Try again.",
    "操作が完了しませんでした。再試行してください。"
  ],
  "操作未完成，请重试或查看日志。": [
    "Operation did not complete. Try again or view logs.",
    "操作が完了しませんでした。再試行するかログを確認してください。"
  ],
  "文件 · 终端 · 开发工具": [
    "Files · Terminal · Development",
    "ファイル・ターミナル・開発ツール"
  ],
  "文件、终端与开发工具": [
    "Files, terminals, and development tools",
    "ファイル、ターミナル、開発ツールは"
  ],
  "文件夹必须是已存在的绝对路径。": [
    "Directories must be existing absolute paths.",
    "既存フォルダーの絶対パスを指定してください。"
  ],
  "文件工具访问范围": [
    "File tool access",
    "ファイルツールのアクセス範囲"
  ],
  "无法保存本机配置，原配置已保留。请检查磁盘空间和文件权限。": [
    "Cannot save settings. Original settings retained. Check disk space and file permissions.",
    "設定を保存できません。元の設定は保持しています。空き容量とファイル権限を確認してください。"
  ],
  "无法加密 API Key，原配置已保留。请检查系统安全存储授权。": [
    "Cannot encrypt the API Key. Original settings retained. Check system secure-storage authorization.",
    "API Key を暗号化できません。元の設定は保持しています。安全なストレージへのシステム認可を確認してください。"
  ],
  "无法解密已保存的 Runtime API Key，请重新输入密钥。": [
    "Cannot decrypt the saved Runtime API Key. Enter the key again.",
    "保存済み Runtime API Key を復号できません。再入力してください。"
  ],
  "无法访问本机配置目录，请检查文件权限。": [
    "Cannot access the settings directory. Check file permissions.",
    "設定フォルダーにアクセスできません。ファイル権限を確認してください。"
  ],
  "日志文件夹暂时无法打开。": [
    "Cannot open the log directory right now.",
    "ログフォルダーを開けません。"
  ],
  "显示全部": [
    "Show all",
    "すべて表示"
  ],
  "显示密钥": [
    "Show key",
    "キーを表示"
  ],
  "更换或清除凭据": [
    "Replace or clear credentials",
    "認証情報の変更・削除"
  ],
  "替换密钥时直接输入新值。清除后会停止连接，工作目录与规则设置仍然保留。": [
    "Enter a new key to replace it. Clearing credentials stops the connection but retains directory and rule settings.",
    "新しいキーを入力すると置き換えます。削除すると接続は停止しますが、フォルダーと規約設定は保持します。"
  ],
  "有文件夹不存在或无法读取，请重新选择。": [
    "A directory is missing or unreadable. Select it again.",
    "存在しないか読み込めないフォルダーがあります。選び直してください。"
  ],
  "有未保存的更改": [
    "Unsaved changes",
    "未保存の変更があります"
  ],
  "服务配置页面": [
    "Service settings",
    "サービス設定"
  ],
  "未读取": [
    "Unavailable",
    "未取得"
  ],
  "本地工具检查失败，请确认项目目录可访问，再点击“检查连接”。": [
    "Local tool check failed. Check project access, then check local tools again.",
    "ローカルツールの確認に失敗しました。工程フォルダーへのアクセスを確認し、再確認してください。"
  ],
  "本机工具": [
    "Local tools",
    "ローカルツール"
  ],
  "本机工具检查": [
    "Check local tools",
    "ローカルツールを確認"
  ],
  "本机工具检查通过。": [
    "Local tools passed the check.",
    "ローカルツールの確認に成功しました。"
  ],
  "本机工具配置无法读取，请打开日志目录，检查工具配置文件。": [
    "Cannot read tool settings. Open logs and check the tool configuration.",
    "ツール設定を読み込めません。ログを開いて設定ファイルを確認してください。"
  ],
  "本机已准备好接收请求，下一步在客户端完成接入。": [
    "Local tools are ready. Finish setup in your client.",
    "リクエストを受け付ける準備ができました。クライアントの接続を完了してください。"
  ],
  "本机运行": [
    "Running locally",
    "ローカルで実行中"
  ],
  "本机配置文件无法读取或格式无效。原文件已保留，请查看帮助后修复。": [
    "Settings are unreadable or invalid. The original file is retained. See help to repair it.",
    "設定ファイルを読み込めないか形式が無効です。元のファイルは保持しています。ヘルプを確認してください。"
  ],
  "本机配置目录必须是普通文件夹，不能是符号链接。": [
    "The settings directory must be a regular folder, not a symbolic link.",
    "設定フォルダーにはシンボリックリンクではなく通常のフォルダーを指定してください。"
  ],
  "本机配置目录无效。": [
    "Invalid settings directory.",
    "設定フォルダーが無効です。"
  ],
  "查看 Codex 指引": [
    "Codex guide",
    "Codex ガイド"
  ],
  "查看指引": [
    "View guide",
    "ガイドを見る"
  ],
  "查看日志": [
    "View logs",
    "ログを表示"
  ],
  "检查中": [
    "Checking",
    "確認中"
  ],
  "检查中…": [
    "Checking…",
    "確認中…"
  ],
  "检查本机工具": [
    "Check local tools",
    "ローカルツールを確認"
  ],
  "检查网络、通道所属组织及密钥权限。网络故障会自动重试，凭据错误需要修正后重新连接。": [
    "Check your network, tunnel organization, and key permissions. Network failures retry automatically; fix credential errors before reconnecting.",
    "ネットワーク、トンネルの組織、キー権限を確認してください。通信障害は自動再試行し、認証エラーは修正後に再接続します。"
  ],
  "概览": [
    "Overview",
    "概要"
  ],
  "正在建立安全连接": [
    "Establishing a secure connection",
    "安全な接続を確立しています"
  ],
  "正在建立安全通道…": [
    "Establishing secure tunnel…",
    "安全なトンネルを確立中…"
  ],
  "正在建立安全通道，请稍候。": [
    "Establishing a secure tunnel. Please wait.",
    "安全なトンネルを確立しています。しばらくお待ちください。"
  ],
  "正在恢复安全连接": [
    "Restoring the secure connection",
    "安全な接続を復旧しています"
  ],
  "正在恢复连接…": [
    "Restoring connection…",
    "接続を復旧中…"
  ],
  "正在检查": [
    "Checking",
    "確認中"
  ],
  "正在检查本机工具…": [
    "Checking local tools…",
    "ローカルツールを確認中…"
  ],
  "正在检查本机执行环境": [
    "Checking the local environment",
    "ローカル実行環境を確認しています"
  ],
  "正在确认本机工具是否可用。": [
    "Checking whether local tools are available.",
    "ローカルツールが利用できるか確認しています。"
  ],
  "正在读取组件版本…": [
    "Reading component versions…",
    "コンポーネントのバージョンを取得中…"
  ],
  "正在载入": [
    "Loading",
    "読み込み中"
  ],
  "正在连接": [
    "Connecting",
    "接続中"
  ],
  "正在连接…": [
    "Connecting…",
    "接続中…"
  ],
  "正在重连": [
    "Reconnecting",
    "再接続中"
  ],
  "此密钥没有通道使用权限，请在服务配置页面检查所属组织及 Tunnels Read + Use 权限。": [
    "This key cannot use the tunnel. Check its organization and Tunnels Read + Use permissions in service settings.",
    "このキーにはトンネルの利用権限がありません。サービス設定で所属組織と Tunnels Read + Use 権限を確認してください。"
  ],
  "每一步都有清晰的状态。": [
    "See the status of every step.",
    "各ステップの状態を確認できます。"
  ],
  "添加目录": [
    "Add directory",
    "フォルダーを追加"
  ],
  "清除凭据": [
    "Clear credentials",
    "認証情報を削除"
  ],
  "状态未知": [
    "Unknown status",
    "不明な状態"
  ],
  "由你掌控的执行环境": [
    "Your tools. Your control.",
    "実行環境を自分の手で管理"
  ],
  "由系统加密保存，界面不会回显已保存的密钥。": [
    "Encrypted by the system. Saved keys are never displayed.",
    "システムで暗号化して保存します。保存済みのキーは再表示しません。"
  ],
  "目录设置约束文件工具。终端按当前用户权限执行，目录设置不构成终端沙箱。": [
    "Directory settings restrict file tools. The terminal runs with your user permissions and is not sandboxed by these settings.",
    "フォルダー設定はファイルツールを制限します。ターミナルは現在のユーザー権限で実行され、この設定による隔離はありません。"
  ],
  "等待检查": [
    "Awaiting check",
    "確認待ち"
  ],
  "等待系统凭据授权": [
    "Waiting for credential authorization",
    "認証情報へのアクセス許可を待機中"
  ],
  "等待系统授权": [
    "Awaiting authorization",
    "システム認可待ち"
  ],
  "等待连接": [
    "Awaiting connection",
    "接続待ち"
  ],
  "管理访问目录": [
    "Manage directories",
    "フォルダーを管理"
  ],
  "粘贴": [
    "Paste",
    "貼り付け"
  ],
  "系统安全存储当前不可用，无法保存或读取密钥。请完成系统授权后重试。": [
    "System secure storage is unavailable. Authorize access in the system dialog, then try again.",
    "システムの安全なストレージを利用できません。システム画面で認可してから再試行してください。"
  ],
  "编辑": [
    "Edit",
    "編集"
  ],
  "自动加载": [
    "Automatic",
    "自動読み込み"
  ],
  "自动加载工程规范": [
    "Load project instructions automatically",
    "プロジェクト規約を自動で読み込む"
  ],
  "自动连接设置无效。": [
    "Invalid auto-connect setting.",
    "自動接続の設定が無効です。"
  ],
  "规则按工程、目标目录与内容版本绑定。自动交付由应用保障，理解和遵循规范由客户端模型完成。": [
    "Rules are bound to the project, scope, and content version. The app delivers them; the client model interprets and follows them.",
    "規約は工程、対象フォルダー、内容の版に紐付きます。アプリが提供し、クライアントモデルが理解して従います。"
  ],
  "让耗时命令在后台运行，再分次读取输出。重连不会自动重放工具操作。": [
    "Run long commands in the background and read output in stages. Reconnecting never replays tool operations.",
    "時間のかかるコマンドはバックグラウンドで実行し、出力を分けて読み取ってください。再接続で操作を再実行することはありません。"
  ],
  "设置已保存": [
    "Settings saved",
    "設定を保存しました"
  ],
  "识别工程": [
    "Identify project",
    "工程を特定"
  ],
  "请先保存工作目录设置，再检查本机工具。": [
    "Save work directory settings before checking local tools.",
    "作業フォルダー設定を保存してからツールを確認してください。"
  ],
  "请先在“工作目录”中选择至少一个可访问的本机文件夹。": [
    "Select at least one accessible folder in Work directories first.",
    "先に作業フォルダーでアクセス可能なフォルダーを1つ以上選んでください。"
  ],
  "请先填写 Tunnel ID。": [
    "Enter a Tunnel ID first.",
    "先に Tunnel ID を入力してください。"
  ],
  "请先添加目录": [
    "Add a directory first",
    "先にフォルダーを追加"
  ],
  "请在客户端选择同一通道并验证工具调用。": [
    "Select the same tunnel in your client and verify a tool call.",
    "クライアントで同じトンネルを選び、ツール呼び出しを確認してください。"
  ],
  "请在系统窗口授权访问已保存的凭据。": [
    "Allow access to saved credentials in the system dialog.",
    "システム画面で保存済み認証情報へのアクセスを許可してください。"
  ],
  "请填写 Runtime API Key。": [
    "Enter a Runtime API Key.",
    "Runtime API Key を入力してください。"
  ],
  "请复制已选中的通道标识。": [
    "Copy the selected Tunnel ID.",
    "選択された Tunnel ID をコピーしてください。"
  ],
  "请求来源无效。": [
    "Invalid request source.",
    "リクエスト元が無効です。"
  ],
  "请至少添加一个工作目录。": [
    "Add at least one work directory.",
    "作業フォルダーを1つ以上追加してください。"
  ],
  "请至少选择一个有效的本机文件夹。": [
    "Select at least one valid local folder.",
    "有効なローカルフォルダーを1つ以上選んでください。"
  ],
  "请重新安装应用，或使用一键启动入口检查组件准备结果。": [
    "Reinstall the app or check component setup with the one-click launcher.",
    "アプリを再インストールするか、ワンクリック起動で準備状態を確認してください。"
  ],
  "读取适用规范": [
    "Read instructions",
    "適用規約を読み込む"
  ],
  "输入 Runtime API Key": [
    "Enter Runtime API Key",
    "Runtime API Key を入力"
  ],
  "运行在你的电脑上。": [
    "Run on your computer.",
    "あなたのコンピューターで実行されます。"
  ],
  "还没有工作目录。添加工程或文件夹，开启本机协作。": [
    "No work directories yet. Add a project or folder to get started.",
    "作業フォルダーがありません。工程またはフォルダーを追加してください。"
  ],
  "连接": [
    "Connect",
    "接続"
  ],
  "连接中": [
    "Connecting",
    "接続中"
  ],
  "连接中断，正在自动尝试恢复。": [
    "Connection interrupted. Retrying automatically.",
    "接続が切断されました。自動で復旧を試みています。"
  ],
  "连接你的客户端": [
    "Connect your client",
    "クライアントを接続"
  ],
  "连接客户端，开始第一次本机工具调用。": [
    "Connect a client and make your first local tool call.",
    "クライアントを接続し、ローカルツールを呼び出しましょう。"
  ],
  "连接已停止。": [
    "Connection stopped.",
    "接続を停止しました。"
  ],
  "连接已停止，可以随时重新连接。": [
    "Connection stopped. You can reconnect at any time.",
    "接続は停止中です。いつでも再接続できます。"
  ],
  "连接异常": [
    "Connection issue",
    "接続エラー"
  ],
  "连接时自动检查": [
    "Checked automatically on connection",
    "接続時に自動で確認"
  ],
  "连接暂时中断，正在自动重连。请检查网络或代理设置。": [
    "Connection interrupted. Retrying automatically. Check network or proxy settings.",
    "接続が切断されました。自動再接続中です。ネットワークやプロキシ設定を確認してください。"
  ],
  "连接组件意外退出，正在重新连接。": [
    "The connection component exited unexpectedly. Reconnecting.",
    "接続コンポーネントが予期せず終了しました。再接続しています。"
  ],
  "连接通道": [
    "Connect tunnel",
    "トンネルに接続"
  ],
  "连接配置": [
    "Connection settings",
    "接続設定"
  ],
  "连接需要你的关注": [
    "Your connection needs attention",
    "接続状態の確認が必要です"
  ],
  "连接需要处理": [
    "Connection needs attention",
    "接続の確認が必要です"
  ],
  "连接需要处理，请查看上方提示。": [
    "Connection needs attention. See the message above.",
    "接続状態の確認が必要です。上のメッセージを確認してください。"
  ],
  "选择你希望客户端协作的工程或文件夹。": [
    "Choose projects or folders for your client to work with.",
    "クライアントと連携する工程やフォルダーを選んでください。"
  ],
  "选择允许文件工具访问的目录": [
    "Choose directories for file tool access",
    "ファイルツールがアクセスするフォルダーを選択"
  ],
  "选择协作范围，自动交付工程规范。": [
    "Choose the scope and deliver project instructions automatically.",
    "作業範囲を選び、プロジェクト規約を自動で提供します。"
  ],
  "选择同一通道，再发起一次工具调用。": [
    "Choose the same tunnel, then make a tool call.",
    "同じトンネルを選び、ツールを呼び出してください。"
  ],
  "选择工作目录，保存连接配置，即可开始。": [
    "Choose work directories and save connection settings to begin.",
    "作業フォルダーを選び、接続設定を保存して始めましょう。"
  ],
  "通过官方支持的产品入口使用 Tunnel。运行通道的密钥与调用 API 的凭据分别管理。": [
    "Use Tunnel through an officially supported product. Runtime and API caller credentials are managed separately.",
    "公式対応の製品から Tunnel を利用します。トンネル実行用と API 呼び出し用の認証情報は別々に管理します。"
  ],
  "通道就绪": [
    "Tunnel ready",
    "トンネル準備完了"
  ],
  "通道就绪表示本机可以接收请求。客户端权限与实际调用结果，需要在对应客户端确认。": [
    "Tunnel ready means local tools can receive requests. Verify client permissions and actual calls in the client.",
    "トンネル準備完了はローカル側が受付可能な状態です。権限と実際の呼び出しはクライアントで確認してください。"
  ],
  "通道已就绪": [
    "Tunnel is ready",
    "トンネルの準備ができました"
  ],
  "通道运行组件": [
    "Tunnel runtime",
    "トンネル実行コンポーネント"
  ],
  "遇到问题时，从本机工具与通道状态开始检查。": [
    "Start troubleshooting with local tools and tunnel status.",
    "問題があるときは、ローカルツールとトンネル状態を確認してください。"
  ],
  "配置内容无效，请重新填写。": [
    "Invalid settings. Enter them again.",
    "設定内容が無効です。入力し直してください。"
  ],
  "配置已保存": [
    "Configuration saved",
    "接続設定を保存しました"
  ],
  "配置文件不是独立的普通文件，请检查本机配置目录。": [
    "The settings file is not an independent regular file. Check the settings directory.",
    "設定ファイルが独立した通常のファイルではありません。設定フォルダーを確認してください。"
  ],
  "重做": [
    "Redo",
    "やり直す"
  ],
  "重新连接": [
    "Reconnect",
    "再接続"
  ],
  "重连中": [
    "Reconnecting",
    "再接続中"
  ],
  "链接无效。": [
    "Invalid link.",
    "リンクが無効です。"
  ],
  "长时间任务": [
    "Long-running tasks",
    "時間のかかるタスク"
  ],
  "隐藏其他应用": [
    "Hide others",
    "ほかを隠す"
  ],
  "隐藏密钥": [
    "Hide key",
    "キーを隠す"
  ],
  "需要处理": [
    "Needs attention",
    "確認が必要"
  ],
  "{count} 项可用": [
    "Available: {count}",
    "{count} 項目が利用可能"
  ],
  "{count} 个目录": [
    "Folders: {count}",
    "{count} 個のフォルダー"
  ],
  "已就绪": [
    "Ready",
    "準備完了"
  ],
  "已就绪 · {count} 项工具": [
    "Ready · {count} tools",
    "準備完了・{count} ツール"
  ],
  "移除目录 {directory}": [
    "Remove directory {directory}",
    "フォルダー {directory} を削除"
  ],
  "退出 {product}": [
    "Quit {product}",
    "{product} を終了"
  ],
  "关于 {product}": [
    "About {product}",
    "{product} について"
  ],
  "隐藏 {product}": [
    "Hide {product}",
    "{product} を隠す"
  ],
  "{product} 无法启动": [
    "{product} could not start",
    "{product} を起動できません"
  ],
  "语言": [
    "Language",
    "言語"
  ],
  "界面语言": [
    "Interface language",
    "表示言語"
  ],
  "语言设置无法保存，请重试。": [
    "Cannot save language preference. Try again.",
    "言語設定を保存できません。再試行してください。"
  ],
  "语言设置无效。": [
    "Invalid language preference.",
    "言語設定が無効です。"
  ]
};
  if (typeof module === 'object' && module.exports) module.exports = messages;
  else root.CTHMessages = Object.freeze(messages);
})(typeof window === 'object' ? window : this);
