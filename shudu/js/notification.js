class Toast {
    static container = null;
    static queue = [];
    static isProcessing = false;

    static init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    static show(message, type = 'info', duration = 3000) {
        this.init();
        this.queue.push({ message, type, duration });
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    static async processQueue() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const { message, type, duration } = this.queue.shift();
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-content">${message}</div>
            <button class="toast-close">&times;</button>
        `;

        this.container.appendChild(toast);
        
        // 强制重绘
        toast.offsetHeight;
        toast.classList.add('show');

        const closeToast = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
                this.processQueue();
            }, 300);
        };

        toast.querySelector('.toast-close').addEventListener('click', closeToast);

        await new Promise(resolve => setTimeout(resolve, duration));
        closeToast();
    }

    static success(message, duration) {
        this.show(message, 'success', duration);
    }

    static error(message, duration) {
        this.show(message, 'error', duration);
    }

    static info(message, duration) {
        this.show(message, 'info', duration);
    }

    static warning(message, duration) {
        this.show(message, 'warning', duration);
    }
}

class Dialog {
    static overlay = null;

    static init() {
        if (!this.overlay) {
            this.overlay = document.createElement('div');
            this.overlay.className = 'dialog-overlay';
            document.body.appendChild(this.overlay);
        }
    }

    static confirm(message, options = {}) {
        this.init();
        
        const {
            confirmText = '确定',
            cancelText = '取消',
            confirmClass = 'primary',
            cancelClass = 'secondary'
        } = options;

        return new Promise((resolve) => {
            this.overlay.innerHTML = `
                <div class="dialog">
                    <div class="dialog-content">${message}</div>
                    <div class="dialog-buttons">
                        <button class="dialog-button ${cancelClass}" data-action="cancel">${cancelText}</button>
                        <button class="dialog-button ${confirmClass}" data-action="confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            const handleClick = (e) => {
                const action = e.target.dataset.action;
                if (action) {
                    this.overlay.classList.remove('show');
                    this.overlay.removeEventListener('click', handleClick);
                    setTimeout(() => {
                        resolve(action === 'confirm');
                    }, 300);
                }
            };

            this.overlay.addEventListener('click', handleClick);
            
            // 强制重绘
            this.overlay.offsetHeight;
            this.overlay.classList.add('show');
        });
    }

    static alert(message, options = {}) {
        return this.confirm(message, {
            ...options,
            cancelText: null
        });
    }
}