document.addEventListener('DOMContentLoaded', function() {
    // 检测设备类型
    function detectDevice() {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        
        // 获取指南元素
        const pcInstruction = document.querySelector('.pc-instruction');
        const mobileInstruction = document.querySelector('.mobile-instruction');
        
        // 根据设备类型显示相应的指南
        if (isMobile) {
            if (pcInstruction) pcInstruction.style.display = 'none';
            if (mobileInstruction) mobileInstruction.style.display = 'block';
        } else {
            if (pcInstruction) pcInstruction.style.display = 'block';
            if (mobileInstruction) mobileInstruction.style.display = 'none';
        }
    }
    
    // 初始检测
    detectDevice();
    
    // 窗口大小改变时重新检测
    window.addEventListener('resize', detectDevice);
});