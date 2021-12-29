format.changed:
	@changed-files -f "(md|yml|html)$$" "prettier --single-quote --no-semi --trailing-comma es5 --write" | bash
.PHONY: format.changed

format.all:
	@prettier --single-quote --no-semi --trailing-comma es5 --write '{content,static,archetypes}/**/*.{md,yml,html}'
.PHONY: format.all

sync:
	git pull --recurse-submodules
	git submodule update --remote
.PHONY: sync

show.tags:
	node tools/show-tags.js
.PHONY: show.tags

default: format.changed
.PHONY: default

fixtab:
	@changed-files "node tools/fixtab.js" | bash
.PHONY: fixtab
