(() => {
    const toggle = document.querySelector('[data-menu-toggle]');
    const navigation = document.querySelector('[data-site-navigation]');
    const homeAction = document.querySelector('[data-home-action]');

    homeAction?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    if (!toggle || !navigation) {
        return;
    }

    const closeMenu = () => {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Открыть меню');
        navigation.classList.remove('is-open');
        document.body.classList.remove('menu-open');
    };

    toggle.addEventListener('click', () => {
        const willOpen = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(willOpen));
        toggle.setAttribute('aria-label', willOpen ? 'Закрыть меню' : 'Открыть меню');
        navigation.classList.toggle('is-open', willOpen);
        document.body.classList.toggle('menu-open', willOpen);
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 760) {
            closeMenu();
        }
    });
})();
