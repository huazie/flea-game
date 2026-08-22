/**
 * 游戏页「选择关卡」悬浮面板：右下角 FAB（位于评论 FAB 之上）→ 右侧抽屉，
 * 列出官方关卡 + 自定义关卡（带迷你缩略图），点击即在当前游戏页就地切换关卡。
 * - 官方关卡：SokobanLevels.load()（带缓存），点击调用
 *   window.sokobanGame.switchToOfficial(i) 就地切换（无实例时回退整页刷新 ?level=i）。
 * - 自定义关卡：SokobanUserLevels.getUserLevels()，点击调用
 *   window.sokobanGame.switchToCustom(list, i) 就地切换（无实例时回退写
 *   'sokoban_play_target' 后整页刷新 game.html）。
 * - 支持点遮罩 / 关闭按钮 / Esc 收起；打开时锁定背景滚动。
 */
(function () {
    'use strict';

    var fab = document.getElementById('level-fab');
    var backdrop = document.getElementById('level-backdrop');
    var panel = document.getElementById('level-panel');
    var officialList = document.getElementById('official-list');
    var customList = document.getElementById('custom-list');
    var customEmpty = document.getElementById('custom-empty');
    var closeBtn = document.getElementById('level-close');

    var open = false;
    var prevOverflow = '';
    var officialCache = null;   // 官方关卡只需加载一次

    /** 关卡内容指纹：name + map，用于面板高亮「当前展示关卡」（与内部 levelIndex 解耦） */
    function levelKey(lv) {
        var name = (lv && lv.name) || '';
        var map = (lv && lv.map) ? JSON.stringify(lv.map) : '';
        return name + '\u0001' + map;
    }

    /** 读取当前游戏正在展示的关卡指纹（无实例/未加载则 null） */
    function getCurrentKey() {
        var g = window.sokobanGame;
        if (g && typeof g.getCurrentLevel === 'function') {
            var lv = g.getCurrentLevel();
            if (lv) return levelKey(lv);
        }
        return null;
    }

    /** 在容器内按指纹点亮当前关卡卡片（其余取消） */
    function markCurrent(container, key) {
        if (!container || !key) return;
        Array.prototype.forEach.call(container.children, function (card) {
            card.classList.toggle('is-current', card._key === key);
        });
    }

    /** 点击某卡片时立即把选中态移到该卡（关闭面板后重开会从游戏态重算） */
    function selectCard(card) {
        var sibs = card.parentNode ? card.parentNode.children : [];
        Array.prototype.forEach.call(sibs, function (s) { s.classList.remove('is-current'); });
        card.classList.add('is-current');
    }

    function openPanel() {
        if (open) return;
        open = true;
        panel.classList.add('is-open');
        backdrop.classList.add('is-open');
        fab.classList.add('is-active');
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        render();
    }

    function closePanel() {
        if (!open) return;
        open = false;
        panel.classList.remove('is-open');
        backdrop.classList.remove('is-open');
        fab.classList.remove('is-active');
        document.body.style.overflow = prevOverflow || '';
    }

    /** 构建一张关卡卡片（迷你缩略图 + 名称 + 当前标签），点击触发 onClick */
    function makeCard(level, onClick) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'level-card';
        card._key = levelKey(level);

        var mini = document.createElement('div');
        mini.className = 'level-mini';
        card.appendChild(mini);

        var name = document.createElement('div');
        name.className = 'level-card-name';
        name.textContent = level.name || '未命名关卡';
        card.appendChild(name);

        // 当前关卡标签（默认隐藏，.is-current 时显示）
        var tag = document.createElement('span');
        tag.className = 'level-current-tag';
        tag.textContent = '当前';
        card.appendChild(tag);

        if (window.SokobanMap) window.SokobanMap.renderMiniMap(mini, level);
        // 缩略图交给 renderMiniMap 默认网格（repeat(cols, minmax(12px,1fr))），
        // 单元格借 aspect-ratio 保持正方形；多列卡片较窄时宽关卡（如五连推 23 列）
        // 在卡片内滚动查看，比例不失真、不会被压成细带。

        card.addEventListener('click', function () {
            selectCard(card);     // 立即切换选中态（关闭后重开会从游戏态重算）
            onClick();
        });
        return card;
    }

    function paintOfficial(levels) {
        officialList.innerHTML = '';
        if (!levels || !levels.length) {
            officialList.innerHTML = '<div class="level-empty">官方关卡加载失败</div>';
            return;
        }
        levels.forEach(function (lv, i) {
            var card = makeCard(lv, function () {
                closePanel();
                if (window.sokobanGame && typeof window.sokobanGame.switchToOfficial === 'function') {
                    window.sokobanGame.switchToOfficial(i);
                } else {
                    window.location.href = 'game.html?level=' + i;
                }
            });
            officialList.appendChild(card);
        });
        markCurrent(officialList, getCurrentKey());
    }

    function render() {
        // 官方关卡：优先用缓存，否则加载（异步）
        if (officialCache) {
            paintOfficial(officialCache);
        } else if (window.SokobanLevels && typeof window.SokobanLevels.load === 'function') {
            window.SokobanLevels.load().then(function (levels) {
                officialCache = levels;
                paintOfficial(levels);
            }).catch(function () { paintOfficial([]); });
        } else {
            paintOfficial([]);
        }

        // 自定义关卡：每次打开实时读取（可能刚新增/删除）
        var customs = (window.SokobanUserLevels && typeof window.SokobanUserLevels.getUserLevels === 'function')
            ? window.SokobanUserLevels.getUserLevels() : [];
        customList.innerHTML = '';
        if (!customs.length) {
            customEmpty.style.display = '';
            customList.style.display = 'none';
        } else {
            customEmpty.style.display = 'none';
            customList.style.display = '';
            customs.forEach(function (lv, i) {
                var card = makeCard(lv, function () {
                    var list = customs.map(function (x) { return { name: x.name, map: x.map }; });
                    closePanel();
                    if (window.sokobanGame && typeof window.sokobanGame.switchToCustom === 'function') {
                        window.sokobanGame.switchToCustom(list, i);
                    } else {
                        try {
                            localStorage.setItem('sokoban_play_target',
                                JSON.stringify({ list: list, index: i }));
                        } catch (e) { /* ignore */ }
                        window.location.href = 'game.html';
                    }
                });
                customList.appendChild(card);
            });
            markCurrent(customList, getCurrentKey());
        }
    }

    fab.addEventListener('click', function () {
        if (open) closePanel(); else openPanel();
    });
    backdrop.addEventListener('click', closePanel);
    closeBtn.addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && open) closePanel();
    });
})();
