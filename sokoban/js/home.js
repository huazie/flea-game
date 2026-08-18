/**
 * 推箱子入口页（第一页）逻辑：三个入口按钮分别跳转
 * 开始游戏 → game.html / 查看关卡 → levels.html / 制作关卡 → editor.html
 */
(function () {
    'use strict';
    var btns = document.querySelectorAll('.entry-btn');
    btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var target = btn.getAttribute('data-target');
            if (target) window.location.href = target;
        });
    });
})();
