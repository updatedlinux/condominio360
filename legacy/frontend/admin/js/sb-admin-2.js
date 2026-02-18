(function($) {
  "use strict"; // Start of use strict

  // Toggle the side navigation
  $("#sidebarToggle, #sidebarToggleTop").on('click', function(e) {
    $("body").toggleClass("sidebar-toggled");
    $(".sidebar").toggleClass("toggled");
    if ($(".sidebar").hasClass("toggled")) {
      $('.sidebar .collapse').collapse('hide');
    };
  });

  // Close any open menu accordions when window is resized below 768px
  $(window).resize(function() {
    if ($(window).width() < 768) {
      $('.sidebar .collapse').collapse('hide');
    };
    
    // Toggle the side navigation when window is resized below 480px
    if ($(window).width() < 480 && !$(".sidebar").hasClass("toggled")) {
      $("body").addClass("sidebar-toggled");
      $(".sidebar").addClass("toggled");
      $('.sidebar .collapse').collapse('hide');
    };
  });

  // Prevent the content wrapper from scrolling when the fixed side navigation hovered over
  $('body.fixed-nav .sidebar').on('mousewheel DOMMouseScroll wheel', function(e) {
    if ($(window).width() > 768) {
      var e0 = e.originalEvent,
        delta = e0.wheelDelta || -e0.detail;
      this.scrollTop += (delta < 0 ? 1 : -1) * 30;
      e.preventDefault();
    }
  });

  // Scroll to top button appear
  $(document).on('scroll', function() {
    var scrollDistance = $(this).scrollTop();
    if (scrollDistance > 100) {
      $('.scroll-to-top').fadeIn();
    } else {
      $('.scroll-to-top').fadeOut();
    }
  });

  // Smooth scrolling using jQuery easing
  $(document).on('click', 'a.scroll-to-top', function(e) {
    var $anchor = $(this);
    $('html, body').stop().animate({
      scrollTop: ($($anchor.attr('href')).offset().top)
    }, 1000, 'easeInOutExpo');
    e.preventDefault();
  });

  // Fix: al cerrar el modal superior (Procesar pago / Cubrir impago), Bootstrap quita modal-open y el modal subyacente (Detalles del Grupo SAN) pierde scroll. Restaurar.
  $(document).on('hidden.bs.modal', '.modal', function() {
    var stillOpen = $('.modal.show');
    if (stillOpen.length > 0) {
      // Sigue habiendo un modal abierto: Bootstrap suele quitar modal-open; hay que mantenerlo para que .modal-open .modal { overflow-y: auto } siga aplicando
      $('body').addClass('modal-open');
      stillOpen.each(function() {
        var $modal = $(this);
        $modal.css({ overflowY: 'auto' });
        $modal.find('.modal-body').each(function() {
          this.style.overflowY = 'auto';
        });
      });
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      $('body').removeClass('modal-open');
      $('.modal-backdrop').remove();
    }
  });

})(jQuery); // End of use strict
