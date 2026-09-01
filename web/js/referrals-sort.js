(function (Q) {

Q.onInit.add(function () {
	_bindAll();
}, 'Streams/referrals/sort');

Q.onPageLoad('').set(function () {
	_bindAll();
}, 'Streams/referrals/sort');

function _bindAll() {
	var tables = document.querySelectorAll('.Streams_referrals_table');
	for (var i = 0; i < tables.length; i++) {
		_bindSort(tables[i]);
	}
}

function _bindSort(table) {
	if (!table || table.getAttribute('data-sort-bound')) return;
	table.setAttribute('data-sort-bound', '1');

	var currentSort = null, currentDir = 1;
	var headers = table.querySelectorAll('th[data-sort]');

	for (var i = 0; i < headers.length; i++) {
		(function (th) {
			th.addEventListener('click', function () {
				var key = th.getAttribute('data-sort');
				if (currentSort === key) {
					currentDir *= -1;
				} else {
					currentSort = key;
					currentDir = 1;
				}
				for (var j = 0; j < headers.length; j++) {
					var arr = headers[j].querySelector('.Streams_sort_arrow');
					if (arr) arr.textContent = '';
				}
				var arrow = th.querySelector('.Streams_sort_arrow');
				if (arrow) {
					arrow.textContent = currentDir > 0 ? ' \u25B2' : ' \u25BC';
				}

				var tbody = table.querySelector('tbody');
				var rows = [];
				var trs = tbody.querySelectorAll('tr.Streams_referrals_row');
				for (var r = 0; r < trs.length; r++) {
					rows.push(trs[r]);
				}
				rows.sort(function (a, b) {
					var av = a.getAttribute('data-' + key) || '';
					var bv = b.getAttribute('data-' + key) || '';
					if (key === 'pts' || key === 'sessions') {
						return (parseFloat(av) - parseFloat(bv)) * currentDir;
					}
					return av.localeCompare(bv) * currentDir;
				});
				for (var m = 0; m < rows.length; m++) {
					tbody.appendChild(rows[m]);
				}
			});
		})(headers[i]);
	}
}

})(Q);
