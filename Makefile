.PHONY: build run test package companion
build:
	cd native && swift build -c release
run:
	cd native && swift run MooZ
test:
	./native/Tools/test.sh
package:
	./native/Tools/package-macos.sh
companion:
	python3 native/Tools/build_companion.py
