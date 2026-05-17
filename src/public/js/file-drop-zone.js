/**
 * Drag & drop de archivos: evita que el navegador abra el archivo en otra pestaña
 * y asigna los archivos al input asociado.
 *
 * Uso:
 *   <div data-file-drop data-file-drop-for="mi-input-id" class="...">
 *     <input type="file" id="mi-input-id" class="hidden" />
 *   </div>
 */
(function (global) {
    const DEFAULT_ACTIVE = 'file-drop-zone--dragover';

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function fileMatchesAccept(file, acceptList) {
        if (!acceptList.length) return true;
        const name = file.name.toLowerCase();
        const type = (file.type || '').toLowerCase();
        return acceptList.some((rule) => {
            const r = rule.toLowerCase();
            if (r.startsWith('.')) return name.endsWith(r);
            if (r.endsWith('/*')) return type.startsWith(r.slice(0, -1));
            return type === r;
        });
    }

    function assignFilesToInput(input, fileList) {
        if (!input || !fileList?.length) return false;

        const accept = (input.getAttribute('accept') || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        const picked = [];
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            if (fileMatchesAccept(file, accept)) {
                picked.push(file);
                if (!input.multiple) break;
            }
        }
        if (!picked.length) return false;

        const dt = new DataTransfer();
        picked.forEach((f) => dt.items.add(f));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function setupZone(zone) {
        if (zone.dataset.fileDropInit === '1') return;

        const forId = zone.dataset.fileDropFor;
        const input = forId
            ? document.getElementById(forId)
            : zone.querySelector('input[type="file"]');
        if (!input) return;

        zone.dataset.fileDropInit = '1';
        const activeClass = zone.dataset.fileDropActiveClass || DEFAULT_ACTIVE;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
            zone.addEventListener(ev, preventDefaults);
        });

        zone.addEventListener('dragenter', () => zone.classList.add(activeClass));
        zone.addEventListener('dragover', () => zone.classList.add(activeClass));
        zone.addEventListener('dragleave', (e) => {
            if (!zone.contains(e.relatedTarget)) zone.classList.remove(activeClass);
        });
        zone.addEventListener('drop', (e) => {
            zone.classList.remove(activeClass);
            assignFilesToInput(input, e.dataTransfer?.files);
        });

        if (zone.dataset.fileDropClick !== 'false') {
            zone.addEventListener('click', (e) => {
                if (e.target === input || e.target.closest('a, button, label')) return;
                input.click();
            });
            zone.style.cursor = zone.style.cursor || 'pointer';
        }
    }

    function init(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('[data-file-drop]').forEach(setupZone);
    }

    function preventWindowFileNavigation() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
            document.addEventListener(ev, preventDefaults, false);
        });
    }

    function boot() {
        preventWindowFileNavigation();
        init();
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((m) => {
                m.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.matches?.('[data-file-drop]')) setupZone(node);
                    init(node);
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    global.FileDropZone = { init, setupZone, assignFilesToInput };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(typeof window !== 'undefined' ? window : global);
