# Included after the configured Bochs Makefile. Builds only when explicitly requested.
BW_NODE_INCLUDE ?= /usr/include/node
bw_direct_napi.o: bochs-cpu3-native-direct-board-adapter/napi.cc bochs-cpu3-native-direct-board/abi.h
	$(CXX) -std=c++17 $(CXXFLAGS) -fPIC -pthread -I$(BW_NODE_INCLUDE) -c $< -o $@
bw_direct.node: bw_direct_napi.o $(BX_OBJS) $(SIMX86_OBJS) iodev/libiodev.a iodev/display/libdisplay.a iodev/hdimage/libhdimage.a cpu/libcpu.a cpu/cpudb/libcpudb.a memory/libmemory.a gui/libgui.a $(INSTRUMENT_LIB) $(FPU_LIB)
	$(CXX) -shared -o $@ $(CXXFLAGS) $(LDFLAGS) bw_direct_napi.o $(BX_OBJS) $(SIMX86_OBJS) iodev/libiodev.a iodev/display/libdisplay.a iodev/hdimage/libhdimage.a cpu/libcpu.a cpu/cpudb/libcpudb.a memory/libmemory.a gui/libgui.a $(INSTRUMENT_LIB) $(FPU_LIB) $(GUI_LINK_OPTS) $(DEVICE_LINK_OPTS) $(MCH_LINK_FLAGS) $(SIMX86_LINK_FLAGS) $(READLINE_LIB) $(EXTRA_LINK_OPTS) $(LIBS) -pthread
