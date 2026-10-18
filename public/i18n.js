'use strict';
// Page language: 中文, English, 日本語, Español. Follows the browser at first; the choice is kept.
(function () {
  const KEY = 'tosstoss.lang';
  const LANGS = { zh: '中文', en: 'English', ja: '日本語', es: 'Español' };

  const S = {
    zh: {
      brand: '投桃',
      tagline: '打开网页，互传文件',
      'status.online': '在线', 'status.connecting': '连接中', 'status.offline': '已下线',
      'me.label': '我的设备', rename: '改名',
      'rename.prompt': '给这台设备起个名字（别人会看到）',
      'toast.renamed': '已改名为 {name}',
      'peers.title': '在线设备', selectAll: '全选', selectNone: '全不选',
      'peers.empty': '暂时没有其他在线设备。',
      'peers.emptyLan': '在同一局域网的其他电脑或手机上，用浏览器打开',
      'peers.emptyNet': '在同一 Wi-Fi 的其他设备上打开下面的网址；对方选“对网络公开”后你就能看到它（两边都隐身时互相看不到）。也可以创建房间，通过互联网传递文件。',
      'peers.emptyRoom': '在其他设备上打开下面的链接，或点“加入房间”输入房间码。',
      or: '或',
      'kind.desktop': '电脑', 'kind.mobile': '手机', 'kind.tablet': '平板',
      'send.title': '发送文件',
      'drop.pointer': '点击选择文件，或把文件拖到这里', 'drop.touch': '点这里选择文件或照片', 'drop.sub': '可一次选择多个文件',
      'drop.subMax': '可一次选择多个文件；优先直连，不限大小；直连失败时自动改经服务器中转，超过 {max} 的文件无法发送', 'err.tooLargeRelay': '没能直连；经服务器的文件最大 {max}', 'toast.relayTooLarge': '没能和 {peers} 直连，{file} 超过 {max}，无法经服务器发给它', 'err.tooLarge': '文件超过大小上限',
      'link.direct': '直连', 'link.directFree': '直连 · 不限大小', 'link.relay': '经服务器', 'link.relayMax': '经服务器 · 每个文件最大 {max}', 'link.probing': '检测中…', 'link.recheck': '重新检测',
      'tx.missed': '{peer} 未收到：{why}', 'why.tooLarge': '超过 {max}，未能直连', 'why.offline': '对方不在线', 'why.left': '对方已离开', 'why.directLost': '直连中断',
      remove: '移除 {name}',
      'send.btn': '发送', 'send.btnN': '发送给 {n} 台设备',
      'hint.initial': '先勾选接收设备，再选择文件。',
      'hint.connecting': '正在连接…', 'hint.offline': '你已下线，上线后才能发送。',
      'hint.waiting': '等待其他设备上线…', 'hint.pickPeer': '先勾选接收设备。', 'hint.pickFile': '再选择要发送的文件。',
      'hint.summary': '{n} 个文件，共 {size}',
      'toast.sending': '开始发送给 {names}', sep: '、',
      'transfers.title': '传输记录', clearDone: '清除已完成',
      note: '自动接收已开启：别人发来的文件会直接收下。不想接收？在“谁能看到我”里选“下线”，或关闭本页。',
      overlay: '松开即可添加文件',
      leftDevice: '已离开的设备',
      'tx.from': '来自 {who}', 'tx.to': '发给 {who}', 'tx.received': '已接收', 'tx.delivered': '已送达',
      'tx.queued': '等待发送', 'tx.direct': '直连', 'tx.relay': '经服务器', 'tx.mixed': '部分直连', 'toast.directLost': '与 {peer} 的直连断开，{file} 未送达', 'tx.failed': '失败', save: '保存', cancelSend: '取消发送',
      'err.interrupted': '发送中断', 'err.notConnected': '未连接', 'err.noServer': '服务器没有响应',
      'err.peerOffline': '接收方已离线', 'err.disconnected': '连接已断开', 'err.stalled': '对方长时间没有响应',
      'err.cancelled': '已取消', 'err.incomplete': '文件不完整', 'err.peerCancelled': '对方取消或已离开',
      'toast.peerLeft': '{peer} 已离开，未收到 {file}',
      'toast.received': '已收到 {file}', 'toast.receivedTap': '已收到 {file}，如未自动保存请点“保存”',
      'mode.label': '谁能看到我', 'mode.public': '对网络公开', 'mode.online': '在线', 'mode.hidden': '隐身', 'mode.offline': '下线',
      'mode.offlineHint': '已下线：别人看不到你，也不能给你发文件；你也不能发送。',
      'mode.lanHint': '同一局域网的设备都能看到你并给你发文件。',
      'mode.roomHint': '在房间里：房间内的设备都能看到你并给你发文件（隐身只对同一网络有效）。',
      'room.title': '通过互联网传递文件', 'room.intro': '创建房间，或输入别处的房间码：任何网络的设备都能互相看到并传文件。',
      'net.hiddenHint': '隐身中：同一网络的设备看不到你，也不能给你发文件；你仍可以发给他们。',
      'net.visibleHint': '已公开：和你使用同一网络（同一公网 IP）的设备都能看到你并给你发文件。',
      'room.create': '创建房间', 'room.join': '加入房间', 'room.joinPrompt': '输入房间码',
      'room.bad': '房间码是 4–12 位字母或数字', 'room.label': '房间',
      'room.hint': '打开这个链接或输入这个房间码的设备会出现在这里，不论在哪个网络。',
      'room.qr': '显示二维码', 'room.qrTitle': '用手机扫码加入房间', close: '关闭', 'room.copy': '复制链接', 'room.copied': '链接已复制', 'room.leave': '离开房间',
      'room.joined': '已进入房间 {code}', 'room.left': '已离开房间',
    },
    en: {
      brand: 'Tosstoss',
      tagline: 'Open the page, share files',
      'status.online': 'Online', 'status.connecting': 'Connecting', 'status.offline': 'Offline',
      'me.label': 'My device', rename: 'Rename',
      'rename.prompt': 'Name this device (others will see it)',
      'toast.renamed': 'Renamed to {name}',
      'peers.title': 'Online devices', selectAll: 'Select all', selectNone: 'Select none',
      'peers.empty': 'No other devices online yet.',
      'peers.emptyLan': 'On another computer or phone on the same network, open',
      'peers.emptyNet': 'Open this address on another device on the same Wi-Fi. You\'ll see it once it picks "Public" (two hidden devices can\'t see each other). Or create a room to share across networks.',
      'peers.emptyRoom': 'Open this link on another device, or tap "Join room" there and enter the code.',
      or: 'or',
      'kind.desktop': 'Computer', 'kind.mobile': 'Phone', 'kind.tablet': 'Tablet',
      'send.title': 'Send files',
      'drop.pointer': 'Click to choose files, or drop them here', 'drop.touch': 'Tap here to choose files or photos', 'drop.sub': 'You can pick several files at once',
      'drop.subMax': "You can pick several files at once. Files go directly when possible, with no size limit; if that fails they go via the server automatically, and files over {max} can't be sent", 'err.tooLargeRelay': 'No direct link; files via the server are limited to {max}', 'toast.relayTooLarge': "Couldn't connect directly to {peers}; {file} is over {max}, too big to send via the server", 'err.tooLarge': 'File is over the size limit',
      'link.direct': 'Direct', 'link.directFree': 'Direct · no size limit', 'link.relay': 'Via server', 'link.relayMax': 'Via server · up to {max} per file', 'link.probing': 'Checking…', 'link.recheck': 'Check again',
      'tx.missed': "{peer} didn't get it: {why}", 'why.tooLarge': 'over {max}, no direct link', 'why.offline': 'not online', 'why.left': 'left', 'why.directLost': 'direct link broke',
      remove: 'Remove {name}',
      'send.btn': 'Send', 'send.btnN': ({ n }) => `Send to ${n} device${n === 1 ? '' : 's'}`,
      'hint.initial': 'Pick who receives, then choose files.',
      'hint.connecting': 'Connecting…', 'hint.offline': "You're offline. Go online to send.",
      'hint.waiting': 'Waiting for other devices…', 'hint.pickPeer': 'First pick who receives.', 'hint.pickFile': 'Now choose the files to send.',
      'hint.summary': ({ n, size }) => `${n} file${n === 1 ? '' : 's'}, ${size} in total`,
      'toast.sending': 'Sending to {names}', sep: ', ',
      'transfers.title': 'Transfers', clearDone: 'Clear finished',
      note: 'Auto-receive is on: files sent to you are saved right away. Don\'t want any? Pick "Offline" under "Who can see me", or close this page.',
      overlay: 'Drop to add files',
      leftDevice: 'a device that left',
      'tx.from': 'from {who}', 'tx.to': 'to {who}', 'tx.received': 'Received', 'tx.delivered': 'Delivered',
      'tx.queued': 'Waiting', 'tx.direct': 'Direct', 'tx.relay': 'Via server', 'tx.mixed': 'Partly direct', 'toast.directLost': 'Direct link to {peer} broke; {file} was not delivered', 'tx.failed': 'Failed', save: 'Save', cancelSend: 'Cancel sending',
      'err.interrupted': 'Sending stopped', 'err.notConnected': 'Not connected', 'err.noServer': "Server didn't respond",
      'err.peerOffline': 'Receiver went offline', 'err.disconnected': 'Connection lost', 'err.stalled': 'The other side stopped responding',
      'err.cancelled': 'Cancelled', 'err.incomplete': 'File incomplete', 'err.peerCancelled': 'Sender cancelled or left',
      'toast.peerLeft': "{peer} left and didn't get {file}",
      'toast.received': 'Received {file}', 'toast.receivedTap': 'Received {file}. If it didn\'t save, tap "Save"',
      'mode.label': 'Who can see me', 'mode.public': 'Public', 'mode.online': 'Online', 'mode.hidden': 'Hidden', 'mode.offline': 'Offline',
      'mode.offlineHint': "Offline: no one can see you or send you files, and you can't send either.",
      'mode.lanHint': 'Devices on this local network can see you and send you files.',
      'mode.roomHint': 'In a room: everyone in it can see you and send you files (Hidden applies only to your network).',
      'room.title': 'Send files over the internet', 'room.intro': 'Create a room, or enter a code from another device: devices on any network can see each other and share files.',
      'net.hiddenHint': "Hidden: devices on your network can't see you or send you files. You can still send to them.",
      'net.visibleHint': 'Public: anyone on the same network (same public IP) can see you and send you files.',
      'room.create': 'Create room', 'room.join': 'Join room', 'room.joinPrompt': 'Enter the room code',
      'room.bad': 'A room code is 4–12 letters or digits', 'room.label': 'Room',
      'room.hint': 'Devices that open this link or enter this code show up here, from any network.',
      'room.qr': 'Show QR code', 'room.qrTitle': 'Scan with your phone to join', close: 'Close', 'room.copy': 'Copy link', 'room.copied': 'Link copied', 'room.leave': 'Leave room',
      'room.joined': 'Joined room {code}', 'room.left': 'Left the room',
    },
    ja: {
      brand: '投桃',
      tagline: 'ページを開いてファイルを送り合う',
      'status.online': 'オンライン', 'status.connecting': '接続中', 'status.offline': 'オフライン',
      'me.label': 'この端末', rename: '名前を変更',
      'rename.prompt': 'この端末の名前（相手に表示されます）',
      'toast.renamed': '名前を「{name}」に変更しました',
      'peers.title': 'オンラインの端末', selectAll: 'すべて選択', selectNone: '選択解除',
      'peers.empty': 'ほかにオンラインの端末はありません。',
      'peers.emptyLan': '同じネットワークのほかのパソコンやスマホのブラウザで開いてください：',
      'peers.emptyNet': '同じ Wi-Fi のほかの端末で下のアドレスを開いてください。相手が「公開」を選ぶと表示されます（両方とも非表示だと互いに見えません）。ルームを作ればネットワークをまたいで送れます。',
      'peers.emptyRoom': 'ほかの端末で下のリンクを開くか、「ルームに参加」でコードを入力してください。',
      or: 'または',
      'kind.desktop': 'パソコン', 'kind.mobile': 'スマホ', 'kind.tablet': 'タブレット',
      'send.title': 'ファイルを送る',
      'drop.pointer': 'クリックしてファイルを選ぶか、ここにドロップ', 'drop.touch': 'ここをタップしてファイルや写真を選ぶ', 'drop.sub': '複数のファイルをまとめて選べます',
      'drop.subMax': '複数のファイルをまとめて選べます。まず直接転送を試み、サイズは無制限です。直接接続できない場合は自動的にサーバー経由になり、{max} を超えるファイルは送れません', 'err.tooLargeRelay': '直接接続できませんでした。サーバー経由は最大 {max} です', 'toast.relayTooLarge': '{peers} と直接接続できず、{file} は {max} を超えるためサーバー経由では送れません', 'err.tooLarge': 'ファイルがサイズ上限を超えています',
      'link.direct': '直接接続', 'link.directFree': '直接接続 · サイズ無制限', 'link.relay': 'サーバー経由', 'link.relayMax': 'サーバー経由 · 1 ファイル最大 {max}', 'link.probing': '確認中…', 'link.recheck': '再確認',
      'tx.missed': '{peer} は未受信：{why}', 'why.tooLarge': '{max} を超え、直接接続できず', 'why.offline': 'オフライン', 'why.left': '退出済み', 'why.directLost': '直接接続が切断',
      remove: '{name} を削除',
      'send.btn': '送信', 'send.btnN': '{n} 台に送信',
      'hint.initial': '受け取る端末を選んでから、ファイルを選んでください。',
      'hint.connecting': '接続しています…', 'hint.offline': 'オフラインです。送信するにはオンラインにしてください。',
      'hint.waiting': 'ほかの端末を待っています…', 'hint.pickPeer': 'まず受け取る端末を選んでください。', 'hint.pickFile': '次に送るファイルを選んでください。',
      'hint.summary': '{n} 個のファイル、合計 {size}',
      'toast.sending': '{names} に送信を開始しました', sep: '、',
      'transfers.title': '転送履歴', clearDone: '完了分を消去',
      note: '自動受信がオンです：送られたファイルはすぐに保存されます。受け取りたくないときは「公開範囲」で「オフライン」を選ぶか、このページを閉じてください。',
      overlay: '離すとファイルを追加',
      leftDevice: '退出した端末',
      'tx.from': '{who} から', 'tx.to': '{who} へ', 'tx.received': '受信済み', 'tx.delivered': '送信済み',
      'tx.queued': '待機中', 'tx.direct': '直接転送', 'tx.relay': 'サーバー経由', 'tx.mixed': '一部直接転送', 'toast.directLost': '{peer} との直接接続が切れたため {file} は届きませんでした', 'tx.failed': '失敗', save: '保存', cancelSend: '送信を取り消す',
      'err.interrupted': '送信が中断されました', 'err.notConnected': '未接続', 'err.noServer': 'サーバーが応答しません',
      'err.peerOffline': '受信側がオフラインです', 'err.disconnected': '接続が切れました', 'err.stalled': '相手が長い間応答しません',
      'err.cancelled': '取り消しました', 'err.incomplete': 'ファイルが不完全です', 'err.peerCancelled': '相手が取り消したか退出しました',
      'toast.peerLeft': '{peer} が退出したため {file} は届きませんでした',
      'toast.received': '{file} を受信しました', 'toast.receivedTap': '{file} を受信しました。保存されない場合は「保存」をタップしてください',
      'mode.label': '公開範囲', 'mode.public': '公開', 'mode.online': 'オンライン', 'mode.hidden': '非表示', 'mode.offline': 'オフライン',
      'mode.offlineHint': 'オフライン：相手からは見えずファイルも届きません。こちらからも送れません。',
      'mode.lanHint': '同じ LAN の端末から見え、ファイルを受け取れます。',
      'mode.roomHint': 'ルーム内：ルームの端末から見え、ファイルを受け取れます（非表示は同じネットワークだけに効きます）。',
      'room.title': 'インターネット経由でファイルを送る', 'room.intro': 'ルームを作るか、ほかの端末のコードを入力すると、どのネットワークからでも互いに見えて送り合えます。',
      'net.hiddenHint': '非表示：同じネットワークの端末からは見えず、ファイルも届きません。こちらからは送れます。',
      'net.visibleHint': '公開中：同じネットワーク（同じグローバル IP）の端末から見え、ファイルを受け取れます。',
      'room.create': 'ルームを作成', 'room.join': 'ルームに参加', 'room.joinPrompt': 'ルームコードを入力',
      'room.bad': 'ルームコードは英数字 4〜12 文字です', 'room.label': 'ルーム',
      'room.hint': 'このリンクを開くかコードを入力した端末が、どのネットワークからでもここに表示されます。',
      'room.qr': 'QR コードを表示', 'room.qrTitle': 'スマホで読み取ってルームに参加', close: '閉じる', 'room.copy': 'リンクをコピー', 'room.copied': 'リンクをコピーしました', 'room.leave': 'ルームを退出',
      'room.joined': 'ルーム {code} に参加しました', 'room.left': 'ルームを退出しました',
    },
    es: {
      brand: 'Tosstoss',
      tagline: 'Abre la página y comparte archivos',
      'status.online': 'En línea', 'status.connecting': 'Conectando', 'status.offline': 'Desconectado',
      'me.label': 'Mi dispositivo', rename: 'Cambiar nombre',
      'rename.prompt': 'Ponle nombre a este dispositivo (otros lo verán)',
      'toast.renamed': 'Nombre cambiado a {name}',
      'peers.title': 'Dispositivos en línea', selectAll: 'Seleccionar todo', selectNone: 'Quitar selección',
      'peers.empty': 'Aún no hay otros dispositivos en línea.',
      'peers.emptyLan': 'En otro ordenador o móvil de la misma red, abre',
      'peers.emptyNet': 'Abre esta dirección en otro dispositivo de la misma Wi-Fi. Lo verás cuando elija "Público" (dos dispositivos ocultos no se ven). También puedes crear una sala para compartir entre redes.',
      'peers.emptyRoom': 'Abre este enlace en otro dispositivo, o toca "Unirse a sala" allí e introduce el código.',
      or: 'o',
      'kind.desktop': 'Ordenador', 'kind.mobile': 'Móvil', 'kind.tablet': 'Tableta',
      'send.title': 'Enviar archivos',
      'drop.pointer': 'Haz clic para elegir archivos o suéltalos aquí', 'drop.touch': 'Toca aquí para elegir archivos o fotos', 'drop.sub': 'Puedes elegir varios archivos a la vez',
      'drop.subMax': 'Puedes elegir varios archivos a la vez. Se envían directamente si es posible, sin límite de tamaño; si no, pasan automáticamente por el servidor y no se pueden enviar archivos de más de {max}', 'err.tooLargeRelay': 'Sin conexión directa; vía servidor el límite es {max}', 'toast.relayTooLarge': 'No hubo conexión directa con {peers}; {file} supera {max} y no se puede enviar vía servidor', 'err.tooLarge': 'El archivo supera el límite de tamaño',
      'link.direct': 'Directo', 'link.directFree': 'Directo · sin límite de tamaño', 'link.relay': 'Vía servidor', 'link.relayMax': 'Vía servidor · hasta {max} por archivo', 'link.probing': 'Comprobando…', 'link.recheck': 'Comprobar de nuevo',
      'tx.missed': '{peer} no lo recibió: {why}', 'why.tooLarge': 'supera {max} y no hubo conexión directa', 'why.offline': 'no está conectado', 'why.left': 'se fue', 'why.directLost': 'se cortó la conexión directa',
      remove: 'Quitar {name}',
      'send.btn': 'Enviar', 'send.btnN': ({ n }) => `Enviar a ${n} dispositivo${n === 1 ? '' : 's'}`,
      'hint.initial': 'Elige quién recibe y luego los archivos.',
      'hint.connecting': 'Conectando…', 'hint.offline': 'Estás desconectado. Conéctate para enviar.',
      'hint.waiting': 'Esperando a otros dispositivos…', 'hint.pickPeer': 'Primero elige quién recibe.', 'hint.pickFile': 'Ahora elige los archivos que quieres enviar.',
      'hint.summary': ({ n, size }) => `${n} archivo${n === 1 ? '' : 's'}, ${size} en total`,
      'toast.sending': 'Enviando a {names}', sep: ', ',
      'transfers.title': 'Transferencias', clearDone: 'Borrar terminadas',
      note: 'La recepción automática está activada: los archivos que te envían se guardan al momento. ¿No quieres recibir? Elige "Desconectado" en "Quién me ve" o cierra esta página.',
      overlay: 'Suelta para añadir archivos',
      leftDevice: 'un dispositivo que se fue',
      'tx.from': 'de {who}', 'tx.to': 'para {who}', 'tx.received': 'Recibido', 'tx.delivered': 'Entregado',
      'tx.queued': 'En espera', 'tx.direct': 'Directo', 'tx.relay': 'Vía servidor', 'tx.mixed': 'Parcialmente directo', 'toast.directLost': 'Se cortó la conexión directa con {peer}; {file} no se entregó', 'tx.failed': 'Error', save: 'Guardar', cancelSend: 'Cancelar envío',
      'err.interrupted': 'Envío interrumpido', 'err.notConnected': 'Sin conexión', 'err.noServer': 'El servidor no respondió',
      'err.peerOffline': 'El receptor se desconectó', 'err.disconnected': 'Conexión perdida', 'err.stalled': 'El otro lado dejó de responder',
      'err.cancelled': 'Cancelado', 'err.incomplete': 'Archivo incompleto', 'err.peerCancelled': 'El remitente canceló o se fue',
      'toast.peerLeft': '{peer} se fue y no recibió {file}',
      'toast.received': 'Recibido {file}', 'toast.receivedTap': 'Recibido {file}. Si no se guardó, toca "Guardar"',
      'mode.label': 'Quién me ve', 'mode.public': 'Público', 'mode.online': 'En línea', 'mode.hidden': 'Oculto', 'mode.offline': 'Desconectado',
      'mode.offlineHint': 'Desconectado: nadie te ve ni puede enviarte archivos, y tú tampoco puedes enviar.',
      'mode.lanHint': 'Los dispositivos de esta red local pueden verte y enviarte archivos.',
      'mode.roomHint': 'En una sala: todos los que estén en ella pueden verte y enviarte archivos (Oculto solo se aplica a tu red).',
      'room.title': 'Enviar archivos por internet', 'room.intro': 'Crea una sala o introduce el código de otro dispositivo: los dispositivos de cualquier red podrán verse y compartir archivos.',
      'net.hiddenHint': 'Oculto: los dispositivos de tu red no te ven ni pueden enviarte archivos. Tú sí puedes enviarles.',
      'net.visibleHint': 'Público: cualquiera en tu misma red (misma IP pública) puede verte y enviarte archivos.',
      'room.create': 'Crear sala', 'room.join': 'Unirse a sala', 'room.joinPrompt': 'Introduce el código de la sala',
      'room.bad': 'El código tiene de 4 a 12 letras o números', 'room.label': 'Sala',
      'room.hint': 'Los dispositivos que abran este enlace o introduzcan este código aparecerán aquí, desde cualquier red.',
      'room.qr': 'Mostrar código QR', 'room.qrTitle': 'Escanea con el móvil para unirte', close: 'Cerrar', 'room.copy': 'Copiar enlace', 'room.copied': 'Enlace copiado', 'room.leave': 'Salir de la sala',
      'room.joined': 'Te uniste a la sala {code}', 'room.left': 'Saliste de la sala',
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem(KEY);
      if (S[saved]) return saved;
    } catch {}
    for (const l of navigator.languages || [navigator.language || '']) {
      const base = String(l).toLowerCase().split('-')[0];
      if (S[base]) return base;
    }
    return 'en';
  }

  let lang = detect();
  const listeners = [];

  function t(key, vars = {}) {
    const v = S[lang][key] ?? S.en[key] ?? key;
    if (typeof v === 'function') return v(vars);
    return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }

  // Fill every element marked data-i18n (text) or data-i18n-label (aria-label and title).
  function apply(root = document) {
    document.documentElement.lang = { zh: 'zh-CN', en: 'en', ja: 'ja', es: 'es' }[lang];
    // 投桃 in Chinese and Japanese, Tosstoss in the other languages.
    document.title = t('brand');
    for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
    for (const n of root.querySelectorAll('[data-i18n-label]')) {
      n.setAttribute('aria-label', t(n.dataset.i18nLabel));
      n.title = t(n.dataset.i18nLabel);
    }
  }

  window.I18n = {
    LANGS,
    get lang() { return lang; },
    t,
    apply,
    set(next) {
      if (!S[next] || next === lang) return;
      lang = next;
      try { localStorage.setItem(KEY, next); } catch {}
      apply();
      for (const f of listeners) f();
    },
    onChange(f) { listeners.push(f); },
  };
})();
