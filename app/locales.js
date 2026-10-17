'use strict';
// Chinese source messages, English and Japanese translations. Shared by renderer and main.
(function(root){
  const messages = {
  "允许所有工具": ["Allow all tools","すべてのツールを許可"],
  "已启用并信任的 MCP 服务，其所有工具均可直接调用，包括后续新增或变更的工具。": ["All tools from enabled, trusted MCP servers can be called directly, including tools added or changed later.","有効で信頼済みの MCP サーバーのすべてのツールを直接呼び出せます。後から追加・変更されるツールも含まれます。"],
  "已允许所有工具，无需逐项授权或每次本机确认。关闭后恢复各工具原来的权限。": ["All tools are allowed, without individual authorization or local confirmation for each call. Turn this off to restore each tool’s previous permissions.","すべてのツールが許可されています。個別の権限設定や呼び出しごとのローカル確認は不要です。オフにすると各ツールの元の権限に戻ります。"],
  "此开关只控制本机授权。ChatGPT 仍可能请求确认；在其弹窗中选择“始终允许”可记住当前工具在本次对话中的授权，新对话或刷新后可能再次询问。": ["This switch controls local authorization only. ChatGPT may still ask for confirmation. Choose “Always allow” in its prompt to remember approval for that tool in the current conversation. New or refreshed conversations may ask again.","このスイッチはローカルの権限のみを管理します。ChatGPT では引き続き確認が必要な場合があります。確認画面で「常に許可」を選ぶと、現在の会話でそのツールの許可が記憶されます。新しい会話や再読み込み後には、再び確認される場合があります。"],
  "尚未添加 MCP 服务。添加或导入后，信任并启用服务即可使用其全部工具。": ["No MCP servers added yet. Add or import a server, then trust and enable it to use all its tools.","MCP サーバーはまだありません。追加またはインポートした後、信頼して有効にするとすべてのツールを利用できます。"],
  "当前按各工具的权限执行。开启后自动保存，重启应用仍生效。": ["Each tool uses its own permissions. Turning this on saves it automatically, and it stays on after restarting the app.","現在は各ツールの権限に従います。オンにすると自動保存され、アプリの再起動後も有効です。"],
  "当前所有工具均由顶部总开关统一允许。客户端可能需要刷新工具目录。": ["All tools are currently allowed by the switch above. Clients may need to refresh their tool catalog.","現在は上部のスイッチですべてのツールを許可しています。クライアントでツール一覧の更新が必要な場合があります。"],
  "连接后可预览工具；工具由顶部总开关统一允许。": ["Tools will appear after connecting and are allowed by the switch above.","接続後にツールを確認できます。ツールは上部のスイッチですべて許可されます。"],
  "由“允许所有工具”统一控制，关闭总开关后可单独设置。": ["Controlled by “Allow all tools”. Turn the switch off to set this tool’s permission.","「すべてのツールを許可」で管理されています。オフにすると個別に権限を設定できます。"],
  "添加工作目录或 MCP 服务，保存连接配置，即可开始。": ["Add a working directory or MCP server, then save your connection settings to begin.", "作業ディレクトリまたは MCP サーバーを追加し、接続設定を保存して開始してください。"],
  "未启用文件工具": ["File tools disabled", "ファイルツールは無効です"],
  "已拒绝此次工具调用。": ["This tool call was rejected.", "今回のツール呼び出しを拒否しました。"],
  "此次调用的确认已过期，未获得执行授权。": ["Confirmation expired. This call was not authorized to execute.", "確認期限が切れました。この呼び出しは実行を許可されていません。"],
  "服务认证失败，请检查密钥或请求头。": ["Server authentication failed. Check secrets or request headers.", "サーバー認証に失敗しました。キーまたはリクエストヘッダーを確認してください。"],
  "MCP 操作已取消。": ["The MCP operation was cancelled.", "MCP 操作をキャンセルしました。"],
  "MCP 服务连接失败，请检查配置或稍后重试。": ["MCP server connection failed. Check the configuration or try again later.", "MCP サーバーへの接続に失敗しました。設定を確認するか、後でもう一度お試しください。"],
  "连接 MCP 服务超时，请检查服务是否可用。": ["The MCP connection timed out. Check whether the server is available.", "MCP 接続がタイムアウトしました。サーバーが利用可能か確認してください。"],
  "工具目录已更新，请刷新后重试。": ["The tool catalog changed. Refresh it and retry.", "ツール一覧が更新されました。更新して再試行してください。"],
  "MCP 服务已断开；执行中的调用请先检查实际结果。": ["The MCP server disconnected. Check the actual result of any call that was running.", "MCP サーバーが切断されました。実行中だった呼び出しの実際の結果を先に確認してください。"],
  "调用确认无效，请重新发起请求。": ["The call confirmation is invalid. Make a new request.", "呼び出しの確認が無効です。新しいリクエストを送信してください。"],
  "工具参数无效，请检查后重试。": ["Tool arguments are invalid. Check them and retry.", "ツールの引数が無効です。確認して再試行してください。"],
  "MCP 配置无效，请检查后重试。": ["MCP configuration is invalid. Check it and retry.", "MCP 設定が無効です。確認して再試行してください。"],
  "工具已变更，请刷新列表后重新授权。": ["The tool changed. Refresh the list and authorize it again.", "ツールが変更されました。一覧を更新して権限を再設定してください。"],
  "MCP 消息超过允许大小，请减少请求或返回内容。": ["The MCP message exceeds the size limit. Reduce the request or response content.", "MCP メッセージがサイズ上限を超えています。リクエストまたは応答の内容を減らしてください。"],
  "尚无已授权的工具，请先启用服务并设置工具权限，或添加工作目录。": ["No tools are authorized yet. Enable a server and set tool permissions, or add a working directory.", "許可されたツールがありません。サーバーを有効にしてツール権限を設定するか、作業ディレクトリを追加してください。"],
  "工具权限已变更，此次调用已停止。": ["Tool permissions changed. This call was stopped.", "ツール権限が変更されました。この呼び出しは停止されました。"],
  "服务返回的 MCP 消息无效，连接已停止。": ["The server returned an invalid MCP message. The connection was stopped.", "サーバーが無効な MCP メッセージを返したため、接続を停止しました。"],
  "此服务的 MCP 协议版本暂不支持，请使用兼容版本。": ["This MCP protocol version is unsupported. Use a compatible server version.", "この MCP プロトコルバージョンには対応していません。互換性のあるサーバーをご利用ください。"],
  "此服务有缺失或无法解密的密钥，请编辑并重新填写。": ["This server has missing or unreadable secrets. Edit it and enter them again.", "このサーバーには不足または復号できないキーがあります。編集して再入力してください。"],
  "此服务正在处理较多请求，请稍后重试。": ["The server is handling too many requests. Try again shortly.", "サーバーへのリクエストが多すぎます。しばらくしてから再試行してください。"],
  "MCP 连接已停止。": ["The MCP connection stopped.", "MCP 接続を停止しました。"],
  "调用已超时。若已开始执行，请先检查实际结果。": ["The call timed out. If execution had started, check the actual result first.", "呼び出しがタイムアウトしました。実行が始まっていた場合は実際の結果を先に確認してください。"],
  "工具定义已变更，请重新核对并授权。": ["The tool definition changed. Review it and authorize it again.", "ツールの定義が変更されました。再確認して権限を設定してください。"],
  "此工具尚未获得调用授权。": ["This tool is not authorized for calls.", "このツールは呼び出しを許可されていません。"],
  "请先核对并信任此服务，再连接或测试。": ["Review and trust this server before connecting or testing.", "接続やテストの前にサーバーを確認して信頼してください。"],
  "无法启动服务，请检查命令、参数与工作目录。": ["The server could not start. Check the command, arguments and working directory.", "サーバーを起動できません。コマンド、引数、作業ディレクトリを確認してください。"],
  "MCP 服务连接已关闭。": ["The MCP server connection is closed.", "MCP サーバー接続が閉じられました。"],
  "此服务已在运行，请复用现有连接。": ["This server is already running. Reuse the existing connection.", "このサーバーは実行中です。既存の接続を再利用してください。"],
  "服务 ID 须以小写字母开头，最多 32 位，可含数字、下划线或连字符。": ["Server IDs must start with a lowercase letter, use at most 32 characters, and contain only lowercase letters, numbers, underscores or hyphens.", "サーバー ID は小文字で始め、32 文字以内の小文字英数字・アンダースコア・ハイフンを使用してください。"],
  "请填写启动命令；文件路径须为对应平台的绝对路径。": ["Enter a command. File paths must be absolute for the target platform.", "起動コマンドを入力してください。ファイルパスは対象プラットフォームの絶対パスが必要です。"],
  "启动工作目录须为对应平台的绝对路径。": ["The working directory must be an absolute path for the target platform.", "作業ディレクトリには対象プラットフォームの絶対パスを指定してください。"],
  "服务地址须使用 HTTPS；仅本机回环地址可使用 HTTP，且不能包含账号、密码或片段。": ["Server URLs require HTTPS; only loopback addresses may use HTTP. Do not include credentials or fragments.", "サーバー URL には HTTPS が必要です。HTTP はループバックアドレスのみ使用できます。認証情報やフラグメントを含めないでください。"],
  "此连接方式暂不支持，请选择 stdio 或 Streamable HTTP。": ["This transport is unsupported. Choose stdio or Streamable HTTP.", "この接続方式には対応していません。stdio または Streamable HTTP を選択してください。"],
  "平台覆盖配置无效，请仅使用 darwin 和 win32。": ["Platform overrides are invalid. Use only darwin and win32.", "プラットフォーム別設定が無効です。darwin と win32 のみ使用してください。"],
  "密钥引用无效，请保留原引用或重新输入密钥。": ["The secret reference is invalid. Keep the original reference or enter the secret again.", "キー参照が無効です。元の参照を残すか、キーを再入力してください。"],
  "导入配置无效，请检查 JSON 格式及服务定义。": ["The import is invalid. Check the JSON format and server definitions.", "インポート設定が無効です。JSON 形式とサーバー定義を確認してください。"],
  "导入预览已过期，请重新预览。": ["The import preview expired. Preview it again.", "インポートのプレビュー期限が切れました。再度プレビューしてください。"],
  "导入预览与当前配置冲突，请重新预览。": ["The import preview conflicts with current configuration. Preview it again.", "インポートのプレビューが現在の設定と競合しています。再度プレビューしてください。"],
  "此 MCP 服务已不存在，请刷新列表。": ["This MCP server no longer exists. Refresh the list.", "この MCP サーバーは削除されています。一覧を更新してください。"],
  "MCP 服务数量超过上限（100）。": ["The number of MCP servers exceeds the limit of 100.", "MCP サーバー数が上限の 100 件を超えています。"],
  "MCP 配置超过允许大小，请减少服务或配置内容。": ["MCP configuration exceeds the size limit. Reduce servers or configuration content.", "MCP 設定がサイズ上限を超えています。サーバー数または設定内容を減らしてください。"],
  "此启动配置不适用于当前平台，请填写平台覆盖路径。": ["This launch configuration does not support this platform. Add a platform-specific path.", "この起動設定は現在のプラットフォームに対応していません。プラットフォーム別のパスを指定してください。"],
  "系统安全存储不可用，请完成系统授权后重试。": ["System secure storage is unavailable. Complete system authorization and retry.", "システムの安全なストレージを利用できません。システムの許可を完了して再試行してください。"],
  "密钥无法安全保存，请重试。": ["The secret could not be saved securely. Retry.", "キーを安全に保存できません。再試行してください。"],
  "MCP 配置目录不安全，未读取或写入配置。": ["The MCP configuration directory is unsafe. Configuration was not read or written.", "MCP 設定ディレクトリが安全でないため、設定の読み書きを行っていません。"],
  "MCP 配置存储不可用，请检查目录权限。": ["MCP configuration storage is unavailable. Check directory permissions.", "MCP 設定ストレージを利用できません。ディレクトリ権限を確認してください。"],
  "MCP 配置文件无法读取，原文件已保留。": ["The MCP configuration file could not be read. The original file has been preserved.", "MCP 設定ファイルを読み取れません。元のファイルは保持されています。"],
  "MCP 配置无法保存，请检查目录权限后重试。": ["MCP configuration could not be saved. Check directory permissions and retry.", "MCP 設定を保存できません。ディレクトリ権限を確認して再試行してください。"],
  "MCP 操作未完成，请检查配置后重试。": ["The MCP operation could not complete. Check the configuration and retry.", "MCP 操作を完了できません。設定を確認して再試行してください。"],
  "以小写字母开头，可含数字、下划线或连字符，保存后保持不变。": ["Start with a lowercase letter; numbers, underscores and hyphens are allowed. The ID stays fixed after saving.", "小文字で始め、数字・アンダースコア・ハイフンも使用できます。保存後は変更できません。"],
  "配置本应用的工具服务，再通过安全通道提供给客户端。": ["Configure this app’s tool services and share them with clients through the secure tunnel.", "このアプリのツールサービスを設定し、安全なトンネル経由でクライアントに提供します。"],
  "工作目录：{directory}": ["Working directory: {directory}", "作業ディレクトリ：{directory}"],
  "编辑 MCP 服务": ["Edit MCP server", "MCP サーバーを編集"],
  "添加 MCP 服务": ["Add MCP server", "MCP サーバーを追加"],
  "正在保存…": ["Saving…", "保存中…"],
  "保存服务": ["Save server", "サーバーを保存"],
  "尚未添加 MCP 服务。添加服务或导入配置后，先测试连接再授权工具。": ["No MCP servers yet. Add a server or import configuration, then test the connection and authorize tools.", "MCP サーバーはまだありません。追加または設定をインポートし、接続をテストしてからツールを許可してください。"],
  "已停用": ["Disabled", "無効"],
  "已连接": ["Connected", "接続済み"],
  "等待信任": ["Trust required", "信頼の確認待ち"],
  "未连接": ["Disconnected", "未接続"],
  "协议版本：{version}": ["Protocol version: {version}", "プロトコルバージョン：{version}"],
  "协议版本：尚未协商": ["Protocol version: not negotiated yet", "プロトコルバージョン：未確定"],
  "此服务有缺失的密钥，请编辑并重新填写：{fields}": ["This server has missing secrets. Edit and replace: {fields}", "このサーバーには不足しているキーがあります。編集して再入力してください：{fields}"],
  "停用": ["Disable", "無効にする"],
  "启用": ["Enable", "有効にする"],
  "测试连接": ["Test connection", "接続をテスト"],
  "删除": ["Delete", "削除"],
  "删除此服务会停止连接并移除配置。": ["Deleting this server stops its connection and removes its configuration.", "このサーバーを削除すると接続が停止し、設定が削除されます。"],
  "确认删除": ["Confirm deletion", "削除を確定"],
  "取消": ["Cancel", "キャンセル"],
  "工具与授权（{count}）": ["Tools and permissions ({count})", "ツールと権限（{count}）"],
  "连接后可预览工具；工具默认禁用。": ["Connect to preview tools. All tools are disabled by default.", "接続後にツールを確認できます。ツールは初期状態では無効です。"],
  "调用权限": ["Call permission", "呼び出し権限"],
  "{tool} 的调用权限": ["Call permission for {tool}", "{tool} の呼び出し権限"],
  "禁用": ["Disabled", "無効"],
  "直接调用": ["Allow calls", "確認なしで許可"],
  "每次本机确认": ["Confirm every call locally", "毎回この端末で確認"],
  "输入参数": ["Input schema", "入力スキーマ"],
  "返回格式": ["Output schema", "出力スキーマ"],
  "信任并测试": ["Trust and test", "信頼してテスト"],
  "信任并连接": ["Trust and connect", "信頼して接続"],
  "确认截止：{time}": ["Confirmation expires at {time}", "確認期限：{time}"],
  "拒绝": ["Reject", "拒否"],
  "允许此次调用": ["Allow this call", "今回の呼び出しを許可"],
  "请填写有效的 JSON。": ["Enter valid JSON.", "有効な JSON を入力してください。"],
  "启动参数必须是字符串 JSON 数组。": ["Arguments must be a JSON array of strings.", "起動引数は文字列の JSON 配列で入力してください。"],
  "此字段必须是 JSON 对象。": ["This field must be a JSON object.", "この欄には JSON オブジェクトを入力してください。"],
  "导入后需要重新填写引用的密钥。": ["Referenced secrets must be entered again after importing.", "インポート後に参照先のキーを再入力してください。"],
  "导入仅保存配置，不会启动服务；所有工具保持禁用。": ["Import saves configuration without starting servers. All tools remain disabled.", "インポートは設定のみ保存し、サーバーを起動しません。すべてのツールは無効のままです。"],
  "请填写服务 ID 和显示名称。": ["Enter a server ID and display name.", "サーバー ID と表示名を入力してください。"],
  "调用时限须为 1 到 90 秒。": ["The call timeout must be between 1 and 90 seconds.", "呼び出しの制限時間は 1〜90 秒で指定してください。"],
  "MCP 服务配置已保存。": ["MCP server configuration saved.", "MCP サーバー設定を保存しました。"],
  "MCP 配置已导入，请逐项确认信任与工具授权。": ["MCP configuration imported. Review trust and tool permissions for each server.", "MCP 設定をインポートしました。サーバーごとに信頼とツール権限を確認してください。"],
  "已复制 MCP 配置。": ["MCP configuration copied.", "MCP 設定をコピーしました。"],
  "请复制已选中的 MCP 配置。": ["Copy the selected MCP configuration.", "選択した MCP 設定をコピーしてください。"],
  "等待本机确认": ["Local confirmation required", "この端末での確認待ち"],
  "核对服务、工具和参数后再允许执行。关闭窗口不会自动允许。": ["Review the server, tool and arguments before allowing execution. Closing the window does not grant permission.", "サーバー、ツール、引数を確認してから実行を許可してください。ウィンドウを閉じても自動許可されません。"],
  "文件工具需要先选择工作目录；MCP 扩展可以单独使用。Runtime API Key 仅用于运行通道，不能代替客户端或 API 调用方的凭据。": ["File tools require a working directory. MCP extensions can be used independently. The Runtime API Key runs the tunnel and does not replace client or API credentials.", "ファイルツールには作業ディレクトリが必要です。MCP 拡張は単独で利用できます。Runtime API Key はトンネル専用で、クライアントや API の認証情報とは異なります。"],
  "应用级 MCP 服务": ["MCP servers for this app", "アプリ共通の MCP サーバー"],
  "在 ChatToHarness 中连接工具服务，所有客户端共用；无需创建 Agent。": ["Connect tool services in ChatToHarness for all clients. No agent setup is needed.", "ChatToHarness にツールサービスを接続して、すべてのクライアントで利用できます。エージェントの作成は不要です。"],
  "添加服务": ["Add server", "サーバーを追加"],
  "先信任服务，再逐项授权工具。新增或变更的工具默认禁用，客户端可能需要刷新工具目录。": ["Trust each server, then authorize its tools. New or changed tools are disabled by default. Clients may need to refresh their tool catalog.", "サーバーを信頼してからツールごとに権限を設定してください。追加・変更されたツールは初期状態で無効です。クライアント側で一覧の更新が必要な場合があります。"],
  "确认信任此服务": ["Review server trust", "サーバーの信頼を確認"],
  "本地服务以当前用户身份运行；工作目录白名单不会限制第三方进程。仅连接你信任的服务。": ["Local servers run as your user. Working directory permissions do not restrict third-party processes. Only connect servers you trust.", "ローカルサーバーは現在のユーザー権限で動作します。作業ディレクトリの許可は外部プロセスを制限しません。信頼できるサーバーにのみ接続してください。"],
  "保存配置不会授权工具。请勿将密钥写入命令参数或服务地址。": ["Saving configuration does not authorize tools. Keep secrets out of command arguments and server URLs.", "設定の保存だけではツールは許可されません。起動引数やサーバー URL にキーを記載しないでください。"],
  "服务 ID": ["Server ID", "サーバー ID"],
  "使用小写字母、数字或下划线，保存后保持不变。": ["Use lowercase letters, numbers or underscores. The ID stays fixed after saving.", "小文字の英数字とアンダースコアを使用してください。保存後は変更できません。"],
  "显示名称": ["Display name", "表示名"],
  "连接方式": ["Transport", "接続方式"],
  "调用时限（秒）": ["Call timeout (seconds)", "呼び出しの制限時間（秒）"],
  "包含本机确认的等待时间，最长 90 秒。": ["Includes time waiting for local confirmation, up to 90 seconds.", "この端末での確認待ち時間を含みます。最大 90 秒です。"],
  "启动命令": ["Command", "起動コマンド"],
  "启动参数（JSON 数组）": ["Arguments (JSON array)", "起動引数（JSON 配列）"],
  "启动工作目录（可选）": ["Working directory (optional)", "起動時の作業ディレクトリ（任意）"],
  "环境变量（JSON 对象）": ["Environment variables (JSON object)", "環境変数（JSON オブジェクト）"],
  "Mac / Windows 启动覆盖": ["Mac / Windows command overrides", "Mac / Windows の起動設定"],
  "按平台覆盖 command、args、cwd": ["Override command, args and cwd by platform", "プラットフォーム別の command・args・cwd"],
  "使用 darwin 和 win32；未填写的字段沿用上方配置。": ["Use darwin and win32. Omitted fields use the values above.", "darwin と win32 を使用します。省略した項目は上の設定を引き継ぎます。"],
  "服务地址": ["Server URL", "サーバー URL"],
  "远程服务使用 HTTPS；本机回环地址可使用 HTTP。": ["Remote servers require HTTPS. Local loopback addresses may use HTTP.", "リモートサーバーには HTTPS が必要です。ローカルのループバックアドレスでは HTTP を使用できます。"],
  "请求头（JSON 对象）": ["Request headers (JSON object)", "リクエストヘッダー（JSON オブジェクト）"],
  "环境变量与请求头的新值由系统加密保存；已保存的值仅显示 secretRef 引用。保留引用可继续使用，缺失的密钥需要重新填写。": ["New environment and header values are encrypted by the system. Saved values appear only as secretRef references. Keep a reference to reuse it; missing secrets must be entered again.", "新しい環境変数とヘッダー値はシステムで暗号化して保存されます。保存済みの値は secretRef 参照のみ表示します。参照を残すと再利用でき、不足しているキーは再入力が必要です。"],
  "导入与导出": ["Import and export", "インポートとエクスポート"],
  "支持本应用配置和 mcpServers JSON。导入的服务保持停用，密钥、信任与工具授权不会随导出转移。": ["Supports this app’s format and mcpServers JSON. Imported servers stay disabled. Export does not transfer secrets, trust or tool permissions.", "このアプリの形式と mcpServers JSON に対応します。インポートしたサーバーは無効のままです。キー、信頼、ツール権限はエクスポートされません。"],
  "粘贴配置 JSON": ["Paste configuration JSON", "設定 JSON を貼り付け"],
  "预览导入": ["Preview import", "インポートをプレビュー"],
  "导出配置": ["Export configuration", "設定をエクスポート"],
  "待导入服务": ["Servers to import", "インポートするサーバー"],
  "确认导入（全部停用）": ["Import with all servers disabled", "すべて無効の状態でインポート"],
  "不含密钥的导出 JSON": ["Exported JSON without secrets", "キーを含まないエクスポート JSON"],
  "复制配置": ["Copy configuration", "設定をコピー"],
  "诊断只记录服务、工具、耗时和执行状态。断线重连不会自动重放调用；执行中断时请先检查实际结果。": ["Diagnostics record only the server, tool, duration and execution status. Reconnecting does not replay calls. Check the actual result after an interrupted call.", "診断にはサーバー、ツール、所要時間、実行状態のみ記録します。再接続で呼び出しを自動再実行しません。中断した場合は実際の結果を先に確認してください。"],
  "上次检查：{time}": ["Last checked: {time}", "最終確認：{time}"],
  "读取与搜索自动附带适用规范；没有 AGENTS.md 也可正常工作。写入前交付尚未读取的规范。": ["Reads and searches include applicable guidance. Projects without AGENTS.md work normally. Undelivered guidance is provided before writes.", "読み取りと検索には適用規約を添えます。AGENTS.md がなくても利用できます。書き込み前に未読の規約を渡します。"],
  "应用更新": ["App updates", "アプリの更新"],
  "检查更新": ["Check for updates", "更新を確認"],
  "自动检查更新": ["Automatically check for updates", "更新を自動確認"],
  "启动后检查，此后每 24 小时检查一次。发现新版本时提醒。": ["Check after launch and every 24 hours. Notify when an update is available.", "起動後と以後 24 時間ごとに確認し、新版があればお知らせします。"],
  "正在读取版本…": ["Reading version…", "バージョンを取得中…"],
  "更新下载进度": ["Update download progress", "更新のダウンロード状況"],
  "下载并安装": ["Download and install", "ダウンロードしてインストール"],
  "继续安装": ["Continue installation", "インストールを続行"],
  "查看版本说明 ↗": ["Release notes ↗", "リリースノート ↗"],
  "当前版本 v{version}": ["Current version v{version}", "現在のバージョン v{version}"],
  "当前版本 v{current} · 最新版本 v{latest}": ["Current v{current} · Latest v{latest}", "現在 v{current} · 最新 v{latest}"],
  "尚未检查更新。": ["Updates have not been checked yet.", "更新はまだ確認していません。"],
  "正在检查…": ["Checking…", "確認中…"],
  "正在检查正式发布版本…": ["Checking stable releases…", "安定版を確認中…"],
  "当前没有可用更新。": ["No updates are available.", "利用可能な更新はありません。"],
  "有新版本可用。": ["A new version is available.", "新しいバージョンがあります。"],
  "暂未发布可用的正式版本。": ["No stable release is available yet.", "利用可能な安定版はまだ公開されていません。"],
  "开发模式仅检查版本，请更新源码后重新运行。": ["Development mode checks versions only. Update the source and run again.", "開発モードではバージョン確認のみ行います。ソースを更新して再実行してください。"],
  "正在校验安装包…": ["Verifying the installer…", "インストーラーを検証中…"],
  "正在停止连接并打开安装程序…": ["Stopping the connection and opening the installer…", "接続を停止し、インストーラーを開いています…"],
  "安装包已校验，可以继续安装。": ["The installer is verified and ready.", "インストーラーを検証しました。インストールを続行できます。"],
  "正在下载更新 {percent}%": ["Downloading update {percent}%", "更新をダウンロード中 {percent}%"],
  "发现新版本 v{version}": ["Update available: v{version}", "新版 v{version} があります"],
  "请先保存或撤销未保存的配置，再安装更新。": ["Save or discard unsaved configuration changes before installing.", "未保存の設定を保存または破棄してからインストールしてください。"],
  "校验后会停止连接，打开 DMG 并退出应用。请将新版拖入“应用程序”。": ["After verification, the connection stops, the DMG opens, and the app quits. Drag the new version into Applications.", "検証後に接続を停止してアプリを終了します。DMG の新版を「アプリケーション」にドラッグしてください。"],
  "校验后会停止连接并打开安装向导，随后退出应用。": ["After verification, the connection stops, the installer opens, and the app quits.", "検証後に接続を停止してアプリを終了し、インストールウィザードを開きます。"],
  "更新请求失败，请检查网络后重试。": ["The update request failed. Check your connection and retry.", "更新リクエストに失敗しました。接続を確認して再試行してください。"],
  "更新服务暂时限制请求，请稍后重试。": ["The update service is rate limited. Try again later.", "更新サービスのリクエスト制限に達しました。後でもう一度お試しください。"],
  "无法识别正式发布版本，请稍后重新检查。": ["Cannot read a stable release. Check again later.", "正式リリースを確認できません。後でもう一度確認してください。"],
  "当前系统或架构不支持此更新。": ["This system or architecture is not supported by this update.", "このシステムまたはアーキテクチャは更新に対応していません。"],
  "最新版本尚未提供当前系统的安装包，请稍后重新检查。": ["The latest release has no installer for this system yet. Check again later.", "最新リリースにはこのシステム用のインストーラーがありません。後でもう一度確認してください。"],
  "安装包校验失败或缺少校验信息，未启动安装。请重新检查或下载。": ["Installer verification failed or checksum information is missing. Installation was not started. Check again or download again.", "検証に失敗したか、チェックサムがありません。インストールは開始されていません。再確認または再ダウンロードしてください。"],
  "无法保存安装包，请检查磁盘空间和目录写入权限后重试。": ["Cannot save the installer. Check disk space and folder write permissions, then retry.", "インストーラーを保存できません。空き容量とフォルダーの書き込み権限を確認して再試行してください。"],
  "请先检查更新，再下载安装。": ["Check for updates before downloading and installing.", "先に更新を確認してからダウンロードしてください。"],
  "无法打开安装程序，请重试。": ["Cannot open the installer. Try again.", "インストーラーを開けません。再試行してください。"],
  "自动检查更新设置无效。": ["Invalid automatic update preference.", "更新の自動確認設定が無効です。"],
  "偏好设置无法保存，请重试。": ["Cannot save preferences. Try again.", "設定を保存できません。再試行してください。"],
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
