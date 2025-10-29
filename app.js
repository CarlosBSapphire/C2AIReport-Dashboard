// Accessible tab switching
document.addEventListener('DOMContentLoaded', function () {
	const tablist = document.querySelector('[role="tablist"]');
	if (!tablist) return;

	const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

	function activateTab(tab) {
		// deactivate all
		tabs.forEach(t => {
			t.setAttribute('aria-selected', 'false');
			t.setAttribute('tabindex', '-1');
			const panel = document.getElementById(t.getAttribute('aria-controls'));
			if (panel) panel.hidden = true;
		});

		// activate the requested
		tab.setAttribute('aria-selected', 'true');
		tab.setAttribute('tabindex', '0');
		const panel = document.getElementById(tab.getAttribute('aria-controls'));
		if (panel) panel.hidden = false;
		tab.focus();
	}

	// click handling
	tabs.forEach(tab => {
		tab.addEventListener('click', () => activateTab(tab));

		tab.addEventListener('keydown', (e) => {
			const currentIndex = tabs.indexOf(tab);
			let newIndex = null;

			switch (e.key) {
				case 'ArrowLeft':
					newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
					break;
				case 'ArrowRight':
					newIndex = (currentIndex + 1) % tabs.length;
					break;
				case 'Home':
					newIndex = 0;
					break;
				case 'End':
					newIndex = tabs.length - 1;
					break;
				case 'Enter':
				case ' ': // Space
					activateTab(tab);
					e.preventDefault();
					return;
				default:
					return;
			}

			tabs[newIndex].focus();
			e.preventDefault();
		});
	});
});
// TODO: add pull request
