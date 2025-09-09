// js/chess.js
// 3D Chess Master — cleaned, camera & toast behaviors added
// expects Three.js loaded globally (CDN or local)

(() => {
  // ------- CONFIG -------
  const SIZE = 8;
  const PIECE_VALUES = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };
  const SYMBOLS = {
    white: { king:'♔', queen:'♕', rook:'♖', bishop:'♗', knight:'♘', pawn:'♙' },
    black: { king:'♚', queen:'♛', rook:'♜', bishop:'♝', knight:'♞', pawn:'♟' }
  };

  // ------- STATE -------
  let scene, camera, renderer, raycaster;
  let boardGroup, piecesGroup;
  let boardState = []; // boardState[z][x] = { type, color, mesh }
  let currentPlayer = 'white';
  let gameState = 'playing'; // 'playing'|'ended'
  let moveHistory = []; // stores { move, captured, mover }
  let captured = { white: [], black: [] };
  let useAI = false;
  let resources = { geos: {}, mats: {} };

  // camera / view control
  let is3D = false;
  let autoRotate = false;
  let orientationIndex = 0; // 0 = neutral, 1 = white-front, 2 = black-front
  const cameraTarget = new THREE.Vector3();
  const cameraLookTarget = new THREE.Vector3(0, 0, 0);
  const cameraLookCurrent = new THREE.Vector3(0, 0, 0);
  const CAMERA_LERP = 0.12;

  // DOM
  const loadingScreen = document.getElementById('loadingScreen');
  const app = document.getElementById('app');
  const turnBox = document.getElementById('turnBox');
  const statusBox = document.getElementById('statusBox');
  const wCaptured = document.getElementById('capturedByWhite');
  const bCaptured = document.getElementById('capturedByBlack');
  const newBtn = document.getElementById('newBtn');
  const undoBtn = document.getElementById('undoBtn');
  const aiBtn = document.getElementById('aiBtn');

  // Toast element (created at startup)
  let toastEl = null;
  let toastTimeout = null;

  // ------- INIT / STARTUP -------
  function startup() {
    // show app after a little delay
    setTimeout(() => {
      loadingScreen.style.opacity = '0';
      setTimeout(() => {
        loadingScreen.style.display = 'none';
        app.classList.remove('hidden');
      }, 350);
    }, 900);

    const root = document.getElementById('threeRoot');

    // Three.js scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071226);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    // initial camera position - top view (we'll use cameraTarget for smooth transitions)
    camera.position.set(0, 30, 0.001);
    camera.lookAt(0, 0, 0);
    cameraLookCurrent.copy(cameraLookTarget);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    root.appendChild(renderer.domElement);

    raycaster = new THREE.Raycaster();

    // lights
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(10, 20, 10); scene.add(dir);
    const amb = new THREE.AmbientLight(0xffffff, 0.25); scene.add(amb);

    // groups
    boardGroup = new THREE.Group();
    piecesGroup = new THREE.Group();
    scene.add(boardGroup);
    scene.add(piecesGroup);

    // resources and board
    createResources();
    createBoard();
    initBoardState();
    createPieces();
    updateUI();

    // toast
    createToastElement();

    // event listeners
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('dblclick', onCanvasDblClick);
    window.addEventListener('resize', onResize);

    newBtn.addEventListener('click', resetGame);
    undoBtn.addEventListener('click', undoMove);
    aiBtn.addEventListener('click', toggleAI);

    // set initial camera targets (top)
    setTopCameraTarget();

    animate();
  }

  // ------- RESOURCES -------
  function createResources() {
    const geos = resources.geos, mats = resources.mats;
    geos.pawn = new THREE.ConeGeometry(0.35, 0.9, 20);
    geos.rook = new THREE.CylinderGeometry(0.35, 0.35, 0.8, 20);
    geos.knight = new THREE.ConeGeometry(0.38, 1, 8);
    geos.bishop = new THREE.ConeGeometry(0.34, 1, 20);
    geos.queen = new THREE.ConeGeometry(0.42, 1.05, 20);
    geos.king = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 20);
    geos.square = new THREE.BoxGeometry(1, 0.08, 1);

    mats.lightSquare = new THREE.MeshPhongMaterial({ color: 0xf0d9b5 });
    mats.darkSquare = new THREE.MeshPhongMaterial({ color: 0xb58863 });
    mats.whitePiece = new THREE.MeshPhongMaterial({ color: 0xf5f5f5, shininess: 120 });
    mats.blackPiece = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 30 });
    mats.highlight = new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0.25 });

    resources.geos = geos; resources.mats = mats;
  }

  // ------- BOARD CREATION -------
  function createBoard() {
    boardGroup.clear();
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        const isLight = (x + z) % 2 === 0;
        const mat = isLight ? resources.mats.lightSquare : resources.mats.darkSquare;
        const sq = new THREE.Mesh(resources.geos.square, mat);
        sq.position.set(x - 3.5, 0, z - 3.5);
        sq.userData = { type: 'square', x, z };
        boardGroup.add(sq);
      }
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshPhongMaterial({ color: 0x04060a }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.05; scene.add(floor);
  }

  // ------- STATE HELPERS -------
  function initBoardState() {
    boardState = Array(8).fill().map(() => Array(8).fill(null));
  }

  function spawnPiece(type, color, x, z) {
    const geo = resources.geos[type] || resources.geos.pawn;
    const mat = color === 'white' ? resources.mats.whitePiece : resources.mats.blackPiece;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x - 3.5, 0.45, z - 3.5);
    mesh.userData = { type, color, x, z };
    mesh.castShadow = true;
    piecesGroup.add(mesh);
    boardState[z][x] = { type, color, mesh };
  }

  function createPieces() {
    piecesGroup.clear();
    const back = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
    for (let i = 0; i < 8; i++) {
      spawnPiece(back[i], 'black', i, 0);
      spawnPiece('pawn', 'black', i, 1);
      spawnPiece('pawn', 'white', i, 6);
      spawnPiece(back[i], 'white', i, 7);
    }
  }

  // ------- POINTER & MOVES -------
  let selectedMesh = null;
  function onPointerDown(e) {
    if (gameState !== 'playing') return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([...piecesGroup.children, ...boardGroup.children], true);
    if (!hits.length) return;
    const hit = hits[0].object;

    // Select your own piece
    if (hit.userData && hit.userData.color && hit.userData.color === currentPlayer) {
      selectedMesh = hit;
      highlightLegalMoves(selectedMesh);
      return;
    }

    // If square clicked and piece selected -> attempt move
    if (hit.userData && hit.userData.type === 'square' && selectedMesh) {
      const move = { fromX: selectedMesh.userData.x, fromZ: selectedMesh.userData.z, toX: hit.userData.x, toZ: hit.userData.z };
      if (isLegalMove(move, currentPlayer)) {
        performMove(move);
      } else {
        // invalid move feedback
        showToast('Invalid move', 1200);
      }
      clearHighlights();
      selectedMesh = null;
    }
  }

  // ------- MOVE GENERATION / LEGALITY (unchanged logic) -------
  function isInside(x, z) { return x >= 0 && x < 8 && z >= 0 && z < 8; }
  function cloneBoard(bs) {
    const c = Array(8).fill().map(() => Array(8).fill(null));
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (bs[z][x]) c[z][x] = { type: bs[z][x].type, color: bs[z][x].color };
    return c;
  }

  function isLegalMove(move, player) {
    const from = boardState[move.fromZ][move.fromX]; if (!from || from.color !== player) return false;
    if (!isPseudoLegal(move, boardState)) return false;
    const bsClone = cloneBoard(boardState);
    applyMoveOnClone(bsClone, move);
    return !isKingInCheck(bsClone, player);
  }

  function applyMoveOnClone(bs, move) {
    const piece = bs[move.fromZ][move.fromX];
    bs[move.toZ][move.toX] = piece;
    bs[move.fromZ][move.fromX] = null;
    if (piece && piece.type === 'pawn' && (move.toZ === 0 || move.toZ === 7)) bs[move.toZ][move.toX].type = 'queen';
  }

  function isKingInCheck(bs, player) {
    let kx = -1, kz = -1;
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (bs[z][x] && bs[z][x].type === 'king' && bs[z][x].color === player) { kx = x; kz = z; }
    if (kx === -1) return true;
    const opponent = player === 'white' ? 'black' : 'white';
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (bs[z][x] && bs[z][x].color === opponent) {
      const pseudo = { fromX: x, fromZ: z, toX: kx, toZ: kz };
      if (isPseudoLegal(pseudo, bs, true)) return true;
    }
    return false;
  }

  function isPseudoLegal(move, bs, forCheck = false) {
    const piece = bs[move.fromZ] && bs[move.fromZ][move.fromX]; if (!piece) return false;
    const dx = move.toX - move.fromX, dz = move.toZ - move.fromZ, adx = Math.abs(dx), adz = Math.abs(dz);
    const target = bs[move.toZ] && bs[move.toZ][move.toX];
    if (!forCheck && target && target.color === piece.color) return false;

    switch (piece.type) {
      case 'pawn': {
        const dir = piece.color === 'white' ? -1 : 1;
        const start = piece.color === 'white' ? 6 : 1;
        if (dx === 0) {
          if (dz === dir && !target) return true;
          if (dz === 2 * dir && move.fromZ === start && !target && !bs[move.fromZ + dir][move.fromX]) return true;
          return false;
        }
        if (Math.abs(dx) === 1 && dz === dir) { if (target && target.color !== piece.color) return true; return false; }
        return false;
      }
      case 'rook': {
        if (dx !== 0 && dz !== 0) return false;
        return isPathClear(bs, move.fromX, move.fromZ, move.toX, move.toZ);
      }
      case 'bishop': {
        if (adx !== adz) return false;
        return isPathClear(bs, move.fromX, move.fromZ, move.toX, move.toZ);
      }
      case 'queen': {
        if (dx === 0 || dz === 0 || adx === adz) return isPathClear(bs, move.fromX, move.fromZ, move.toX, move.toZ);
        return false;
      }
      case 'knight':
        return (adx === 1 && adz === 2) || (adx === 2 && adz === 1);
      case 'king':
        return Math.max(adx, adz) === 1;
    }
    return false;
  }

  function isPathClear(bs, fX, fZ, tX, tZ) {
    const sx = Math.sign(tX - fX), sz = Math.sign(tZ - fZ);
    let x = fX + sx, z = fZ + sz;
    while (x !== tX || z !== tZ) { if (bs[z][x]) return false; x += sx; z += sz; }
    return true;
  }

  function generatePseudoMoves(x, z, bs) {
    const p = bs[z][x]; if (!p) return [];
    const moves = []; const t = p.type; const color = p.color; const dir = color === 'white' ? -1 : 1;
    if (t === 'pawn') {
      if (isInside(x, z + dir) && !bs[z + dir][x]) moves.push({ toX: x, toZ: z + dir });
      const start = (color === 'white' ? 6 : 1);
      if (z === start && !bs[z + dir][x] && !bs[z + 2 * dir][x]) moves.push({ toX: x, toZ: z + 2 * dir });
      [[x - 1, z + dir], [x + 1, z + dir]].forEach(([nx, nz]) => { if (isInside(nx, nz) && bs[nz][nx] && bs[nz][nx].color !== color) moves.push({ toX: nx, toZ: nz }); });
    } else if (t === 'knight') {
      const d = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
      d.forEach(([dx, dz]) => { const nx = x + dx, nz = z + dz; if (isInside(nx, nz) && (!bs[nz][nx] || bs[nz][nx].color !== color)) moves.push({ toX: nx, toZ: nz }); });
    } else if (t === 'rook' || t === 'bishop' || t === 'queen') {
      const dirs = (t === 'rook') ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : (t === 'bishop') ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      dirs.forEach(([dx, dz]) => { let nx = x + dx, nz = z + dz; while (isInside(nx, nz)) { if (!bs[nz][nx]) { moves.push({ toX: nx, toZ: nz }); } else { if (bs[nz][nx].color !== color) moves.push({ toX: nx, toZ: nz }); break; } nx += dx; nz += dz; } });
    } else if (t === 'king') {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (dx === 0 && dz === 0) continue; const nx = x + dx, nz = z + dz; if (isInside(nx, nz) && (!bs[nz][nx] || bs[nz][nx].color !== color)) moves.push({ toX: nx, toZ: nz }); }
    }
    return moves;
  }

  // ------- PERFORM MOVE (with toast hooks) -------
  function performMove(move) {
    const from = boardState[move.fromZ][move.fromX];
    const target = boardState[move.toZ][move.toX];
    const mover = currentPlayer;

    moveHistory.push({ move, captured: target ? { type: target.type, color: target.color } : null, mover });

    if (target) {
      // add to captured by mover
      captured[mover].push(target.type);
      updateCapturedUI();
      // remove target mesh
      if (target.mesh) piecesGroup.remove(target.mesh);
      boardState[move.toZ][move.toX] = null; // will be set below
    }

    const mesh = from.mesh || findMeshAt(move.fromX, move.fromZ) || from.mesh;

    // update board state
    boardState[move.toZ][move.toX] = { type: from.type, color: from.color, mesh: mesh };
    boardState[move.fromZ][move.fromX] = null;

    if (mesh) {
      mesh.position.set(move.toX - 3.5, 0.45, move.toZ - 3.5);
      mesh.userData = { type: from.type, color: from.color, x: move.toX, z: move.toZ };
    }

    // promotion
    if (from.type === 'pawn' && (move.toZ === 0 || move.toZ === 7)) {
      boardState[move.toZ][move.toX].type = 'queen';
      if (mesh) mesh.geometry = resources.geos.queen;
    }

    // small toast messages
    const pieceName = capitalize(from.type);
    showToast(`He moved ${pieceName}`, 1500);
    if (target) {
      // if captured high value piece -> praise
      if (['queen','rook'].includes(target.type)) {
        setTimeout(()=> showToast("That's a great move! 🔥", 1700), 400);
      } else {
        setTimeout(()=> showToast(`Captured ${target.type}`, 1200), 350);
      }
    }

    // toggle player
    currentPlayer = currentPlayer === 'white' ? 'black' : 'white';
    updateTurnUI();
    evaluateGameState();

    if (useAI && currentPlayer === 'black' && gameState === 'playing') {
      setTimeout(makeBestAIMove, 220);
    }
  }

  function findMeshAt(x, z) {
    for (const ch of piecesGroup.children) if (ch.userData && ch.userData.x === x && ch.userData.z === z) return ch;
    return null;
  }

  // ------- UNDO -------
  function undoMove() {
    if (!moveHistory.length) return;
    const last = moveHistory.pop();
    const m = last.move, cap = last.captured, mover = last.mover;

    // moved piece currently at toX,toZ
    const moved = boardState[m.toZ][m.toX];
    // move it back
    boardState[m.fromZ][m.fromX] = moved;
    boardState[m.toZ][m.toX] = null;

    if (moved && moved.mesh) {
      moved.mesh.position.set(m.fromX - 3.5, 0.45, m.fromZ - 3.5);
      moved.mesh.userData.x = m.fromX; moved.mesh.userData.z = m.fromZ; moved.mesh.userData.type = moved.type;
    }

    if (cap) {
      // respawn captured piece at toX,toZ
      spawnPiece(cap.type, cap.color, m.toX, m.toZ);
      // remove last captured from mover
      if (captured[mover] && captured[mover].length) captured[mover].pop();
    }

    currentPlayer = mover; // restore player who made the previous move's turn? (safe)
    updateUI();
    gameState = 'playing';
    statusBox.textContent = 'Game in Progress';
  }

  // ------- HIGHLIGHTS (minimal) -------
  function highlightLegalMoves(mesh) {
    if (!mesh) return;
    mesh.scale.set(1.08, 1.08, 1.08);
    setTimeout(()=>{ mesh.scale.set(1,1,1); }, 350);
  }
  function clearHighlights() { /* no-op for now */ }

  // ------- UI updates -------
  function updateTurnUI() { turnBox.textContent = `${capitalize(currentPlayer)}'s Turn`; }
  function updateCapturedUI() {
    wCaptured.innerHTML = ''; bCaptured.innerHTML = '';
    captured.white.forEach(t => { const d = document.createElement('div'); d.className = 'cap-piece'; d.textContent = SYMBOLS.black[t]; wCaptured.appendChild(d); });
    captured.black.forEach(t => { const d = document.createElement('div'); d.className = 'cap-piece'; d.textContent = SYMBOLS.white[t]; bCaptured.appendChild(d); });
  }
  function updateUI() { updateTurnUI(); updateCapturedUI(); }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------- GAME STATE EVAL -------
  function evaluateGameState() {
    const opponent = currentPlayer;
    const legal = allLegalMovesFor(opponent);
    const inCheck = isKingInCheck(boardState, opponent);
    if (legal.length === 0) {
      gameState = 'ended';
      statusBox.textContent = inCheck ? `${capitalize(opponent)} is checkmated!` : 'Stalemate';
      // show toast
      setTimeout(()=> showToast(statusBox.textContent, 2200), 100);
    } else {
      statusBox.textContent = 'Game in Progress';
    }
  }

  // ------- MOVE GENERATION (same) -------
  function allLegalMovesFor(player) {
    const moves = [];
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
      const p = boardState[z][x]; if (!p || p.color !== player) continue;
      const pseudo = generatePseudoMoves(x, z, boardState);
      for (const mv of pseudo) {
        const m = { fromX: x, fromZ: z, toX: mv.toX, toZ: mv.toZ };
        if (isLegalMove(m, player)) moves.push(m);
      }
    }
    return moves;
  }

  // ------- AI: naive depth-2 search (same) -------
  function makeBestAIMove() {
    const moves = allLegalMovesFor('black'); if (!moves.length) return;
    let best = null; let bestScore = Infinity;
    moves.forEach(m => {
      const clone = cloneBoard(boardState); applyMoveOnClone(clone, m);
      const oppMoves = [];
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) if (clone[z][x] && clone[z][x].color === 'white') {
        generatePseudoMoves(x, z, clone).forEach(pm => { const cand = { fromX: x, fromZ: z, toX: pm.toX, toZ: pm.toZ }; if (isLegalMove(cand, 'white')) oppMoves.push(cand); });
      }
      let worst = -Infinity;
      if (!oppMoves.length) worst = evaluateMaterial(clone);
      else oppMoves.forEach(om => { const c2 = cloneBoard(clone); applyMoveOnClone(c2, om); worst = Math.max(worst, evaluateMaterial(c2)); });
      if (worst < bestScore) { bestScore = worst; best = m; }
    });
    if (best) {
      performMove(best);
    }
  }

  function evaluateMaterial(bs) {
    let score = 0;
    for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) { const p = bs[z][x]; if (p) score += (p.color === 'white' ? 1 : -1) * (PIECE_VALUES[p.type] || 0); }
    return score;
  }

  // ------- UTIL (same) -------
  function generatePseudoMoves(x, z, bs) {
    const p = bs[z][x]; if (!p) return [];
    const moves = []; const t = p.type; const color = p.color; const dir = color === 'white' ? -1 : 1;
    if (t === 'pawn') {
      if (isInside(x, z + dir) && !bs[z + dir][x]) moves.push({ toX: x, toZ: z + dir });
      const start = (color === 'white' ? 6 : 1);
      if (z === start && !bs[z + dir][x] && !bs[z + 2 * dir][x]) moves.push({ toX: x, toZ: z + 2 * dir });
      [[x - 1, z + dir], [x + 1, z + dir]].forEach(([nx, nz]) => { if (isInside(nx, nz) && bs[nz][nx] && bs[nz][nx].color !== color) moves.push({ toX: nx, toZ: nz }); });
    } else if (t === 'knight') {
      const d = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
      d.forEach(([dx, dz]) => { const nx = x + dx, nz = z + dz; if (isInside(nx, nz) && (!bs[nz][nx] || bs[nz][nx].color !== color)) moves.push({ toX: nx, toZ: nz }); });
    } else if (t === 'rook' || t === 'bishop' || t === 'queen') {
      const dirs = (t === 'rook') ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : (t === 'bishop') ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      dirs.forEach(([dx, dz]) => { let nx = x + dx, nz = z + dz; while (isInside(nx, nz)) { if (!bs[nz][nx]) moves.push({ toX: nx, toZ: nz }); else { if (bs[nz][nx].color !== color) moves.push({ toX: nx, toZ: nz }); break; } nx += dx; nz += dz; } });
    } else if (t === 'king') {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (dx === 0 && dz === 0) continue; const nx = x + dx, nz = z + dz; if (isInside(nx, nz) && (!bs[nz][nx] || bs[nz][nx].color !== color)) moves.push({ toX: nx, toZ: nz }); }
    }
    return moves;
  }

  // ------- Camera view helpers & canvas controls -------
  function setTopCameraTarget() {
    // top-down slightly offset to avoid exact vertical look vector
    cameraTarget.set(0, 30, 0.001);
    cameraLookTarget.set(0, 0, 0);
    orientationIndex = 0; is3D = false; autoRotate = false;
  }
  function setNeutral3DTarget() {
    cameraTarget.set(8, 12, 8);
    cameraLookTarget.set(0, 0, 0);
    orientationIndex = 0; is3D = true;
  }
  function setWhiteFrontTarget() {
    cameraTarget.set(0, 10, 12);
    cameraLookTarget.set(0, 0, 0);
    orientationIndex = 1;
  }
  function setBlackFrontTarget() {
    cameraTarget.set(0, 10, -12);
    cameraLookTarget.set(0, 0, 0);
    orientationIndex = 2;
  }

  function onCanvasDblClick(e) {
    // toggle: if not in3D -> enter 3D neutral view; else toggle auto-rotate
    if (!is3D) {
      setNeutral3DTarget();
      showToast('3D view enabled');
    } else {
      autoRotate = !autoRotate;
      showToast(autoRotate ? 'Auto-rotate enabled 🔄' : 'Auto-rotate stopped ⏹️');
    }
  }

  function onCanvasClick(e) {
    // only cycle orientation while in 3D, and only if click was on empty area (not on piece/square)
    if (!is3D) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects([...piecesGroup.children, ...boardGroup.children], true);

    // if clicked on a board object or piece, ignore orientation cycling
    if (hits.length) {
      const hit = hits[0].object;
      if (hit.userData && (hit.userData.type === 'square' || hit.userData.color)) {
        return;
      }
    }

    // cycle orientations neutral -> white -> black -> neutral
    orientationIndex = (orientationIndex + 1) % 3;
    if (orientationIndex === 0) setNeutral3DTarget();
    else if (orientationIndex === 1) setWhiteFrontTarget();
    else setBlackFrontTarget();

    const label = orientationIndex === 1 ? 'White side' : orientationIndex === 2 ? 'Black side' : 'Neutral';
    showToast(label);
  }

  // ------- Toast UI -------
  function createToastElement() {
    toastEl = document.createElement('div');
    toastEl.className = 'toast'; // make sure you have toast CSS in style.css (snippet below)
    // fallback inline styles (in case CSS is missing)
    toastEl.style.position = 'fixed';
    toastEl.style.bottom = '30px';
    toastEl.style.left = '50%';
    toastEl.style.transform = 'translateX(-50%)';
    toastEl.style.padding = '10px 18px';
    toastEl.style.borderRadius = '10px';
    toastEl.style.background = 'rgba(20,20,20,0.92)';
    toastEl.style.color = '#fff';
    toastEl.style.fontSize = '14px';
    toastEl.style.boxShadow = '0 8px 20px rgba(0,0,0,0.4)';
    toastEl.style.opacity = '0';
    toastEl.style.transition = 'all 0.35s ease';
    toastEl.style.pointerEvents = 'none';
    toastEl.style.zIndex = '200';
    document.body.appendChild(toastEl);
  }

  function showToast(msg, duration = 1800) {
    if (!toastEl) createToastElement();
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null; }
    toastEl.textContent = msg;
    toastEl.style.transform = 'translateX(-50%) translateY(0px)';
    toastEl.style.opacity = '1';
    toastTimeout = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastTimeout = setTimeout(() => {
        if (toastEl) toastEl.style.transform = 'translateX(-50%) translateY(10px)';
      }, 350);
    }, duration);
  }

  // ------- RENDER LOOP (single, unified) -------
  function animate() {
    requestAnimationFrame(animate);

    // Smoothly move camera toward cameraTarget
    camera.position.lerp(cameraTarget, CAMERA_LERP);
    cameraLookCurrent.lerp(cameraLookTarget, CAMERA_LERP);
    camera.lookAt(cameraLookCurrent);

    // Auto-rotate board if enabled
    if (autoRotate) {
      boardGroup.rotation.y += 0.01;
    }

    renderer.render(scene, camera);
  }

  // ------- Canvas resize handler -------
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------- Controls: reset / undo / toggle AI -------
  function resetGame() {
    piecesGroup.clear(); initBoardState(); createPieces(); currentPlayer = 'white';
    gameState = 'playing'; moveHistory = []; captured = { white: [], black: [] }; updateUI(); statusBox.textContent = 'Game in Progress';
    setTopCameraTarget(); showToast('New Game');
  }
  function toggleAI() { useAI = !useAI; aiBtn.textContent = useAI ? 'AI: ON' : 'Play vs AI'; if (useAI && currentPlayer === 'black') setTimeout(makeBestAIMove, 250); }

  // ------- export / start -------
  startup();

})();
